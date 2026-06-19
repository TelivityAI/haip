/**
 * Fastify app: ChatGPT action endpoints + /openapi.json + /health + /privacy + landing.
 *
 * Every action route is wrapped by `action()`, which times the call, scrubs the
 * request and response, and logs the tool call to Supabase. The upstream HAIP
 * `x-api-key` is injected by the adapter and never appears in the spec or here.
 */

import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import { timingSafeEqual } from 'node:crypto';
import {
  HaipConnectAdapter,
  UpstreamError,
  type BookInput,
  type ModifyInput,
  type SearchInput,
} from './haip-connect-adapter.js';
import { buildOpenApiSpec } from './openapi.js';
import { logToolCall } from './events.js';
import { redactForLog } from './scrub.js';
import { indexHtml, privacyHtml } from './pages.js';

export interface AppOptions {
  adapter: HaipConnectAdapter;
  publicBaseUrl: string;
  /**
   * Credential the caller (the ChatGPT Action) must present to reach the action
   * routes — sent as `Authorization: Bearer <key>` or `x-api-key`. The gateway
   * holds HAIP's privileged upstream Connect key, so without this anyone on the
   * internet who finds the URL can drive the Connect API. Configure via GATEWAY_API_KEY.
   */
  gatewayApiKey?: string;
  /**
   * Explicit opt-out that leaves the action routes public (the unauthenticated
   * demo). Mirrors HAIP_ALLOW_INSECURE — secure-by-default otherwise.
   */
  allowPublic?: boolean;
}

/** Public routes that never require a caller credential. */
const PUBLIC_PATHS = new Set(['/health', '/openapi.json', '/', '/privacy']);

function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** Extract the caller credential from `Authorization: Bearer` or `x-api-key`. */
function extractCredential(req: FastifyRequest): string | null {
  const auth = req.headers['authorization'];
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) return auth.slice(7).trim();
  const key = req.headers['x-api-key'];
  if (typeof key === 'string') return key;
  if (Array.isArray(key)) return key[0] ?? null;
  return null;
}

export function buildApp(opts: AppOptions): FastifyInstance {
  const { adapter, publicBaseUrl } = opts;
  const app = Fastify({ logger: true });

  app.register(cors, { origin: true });

  // Require a caller credential on every non-public route. The gateway proxies
  // requests with HAIP's privileged upstream `x-api-key`, so an unauthenticated
  // gateway is an open door to the Connect API. Fail-closed: if no key is
  // configured and `allowPublic` was not explicitly set, refuse action routes.
  app.addHook('onRequest', async (req, reply) => {
    const path = (req.url.split('?')[0] ?? req.url).replace(/\/+$/, '') || '/';
    if (PUBLIC_PATHS.has(path)) return;
    if (opts.allowPublic) return;
    const provided = extractCredential(req);
    if (!opts.gatewayApiKey || !provided || !timingSafeEqualStr(provided, opts.gatewayApiKey)) {
      reply.code(401).send({ error: 'unauthorized', message: 'A valid gateway credential is required.' });
    }
  });

  app.get('/health', async () => ({
    status: 'ok',
    service: 'haip-connect-gpt',
    upstreamHealthy: await adapter.upstreamHealthy(),
    timestamp: new Date().toISOString(),
  }));

  app.get('/openapi.json', async (_req, reply) => {
    reply.type('application/json').send(buildOpenApiSpec(publicBaseUrl));
  });

  app.get('/', async (_req, reply) => reply.type('text/html').send(indexHtml));
  app.get('/privacy', async (_req, reply) => reply.type('text/html').send(privacyHtml));

  // --- ChatGPT action endpoints (paths mirror the OpenAPI spec) ---

  app.post(
    '/hotels/search',
    action('searchHotels', (req) => adapter.searchHotels(req.body as SearchInput)),
  );

  app.get(
    '/hotels/:propertyId',
    action('getProperty', (req) => adapter.getProperty((req.params as { propertyId: string }).propertyId)),
  );

  app.post(
    '/reservations',
    action('createReservation', (req) => adapter.createReservation(req.body as BookInput), 201),
  );

  app.get(
    '/reservations/:confirmationNumber',
    action('getReservation', (req) =>
      adapter.getReservation((req.params as { confirmationNumber: string }).confirmationNumber),
    ),
  );

  app.patch(
    '/reservations/:confirmationNumber',
    action('modifyReservation', (req) =>
      adapter.modifyReservation(
        (req.params as { confirmationNumber: string }).confirmationNumber,
        req.body as ModifyInput,
      ),
    ),
  );

  app.delete(
    '/reservations/:confirmationNumber',
    action('cancelReservation', (req) =>
      adapter.cancelReservation(
        (req.params as { confirmationNumber: string }).confirmationNumber,
        (req.body as { reason?: string } | undefined)?.reason,
      ),
    ),
  );

  return app;
}

/**
 * Wraps an action handler with timing, PII-scrubbed logging, and error mapping.
 * Upstream (HAIP) errors are forwarded with their original status + body.
 */
function action(
  tool: string,
  run: (req: FastifyRequest) => Promise<unknown>,
  successStatus = 200,
) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const start = Date.now();
    const sessionId = sessionFrom(req);
    const requestPayload = { params: req.params, query: req.query, body: req.body };

    // logToolCall is awaited (not fire-and-forget): on serverless the instance
    // can be frozen the moment the response is sent, which would drop the
    // insert. It is still best-effort — logToolCall never throws.
    try {
      const result = await run(req);
      await logToolCall({
        tool,
        sessionId,
        request: redactForLog(requestPayload),
        response: redactForLog(result),
        status: 'ok',
        latencyMs: Date.now() - start,
      });
      reply.status(successStatus).send(result);
    } catch (err) {
      const status = err instanceof UpstreamError ? err.status : 500;
      const body =
        err instanceof UpstreamError
          ? (err.body ?? { error: 'upstream_error' })
          : { error: 'gateway_error', message: (err as Error).message };
      await logToolCall({
        tool,
        sessionId,
        request: redactForLog(requestPayload),
        response: null,
        status: 'error',
        error: typeof body === 'string' ? body : JSON.stringify(body),
        latencyMs: Date.now() - start,
      });
      reply.status(status).send(body);
    }
  };
}

/** ChatGPT sends a per-conversation pseudonymous id in this header. */
function sessionFrom(req: FastifyRequest): string | null {
  const raw = req.headers['openai-ephemeral-user-id'];
  if (Array.isArray(raw)) return raw[0] ?? null;
  return raw ?? null;
}
