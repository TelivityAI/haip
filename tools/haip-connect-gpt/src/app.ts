/**
 * Fastify app: ChatGPT action endpoints + /openapi.json + /health + /privacy + landing.
 *
 * Every action route is wrapped by `action()`, which times the call, scrubs the
 * request and response, and logs the tool call to Supabase. The upstream HAIP
 * `x-api-key` is injected by the adapter and never appears in the spec or here.
 */

import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
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
}

export function buildApp(opts: AppOptions): FastifyInstance {
  const { adapter, publicBaseUrl } = opts;
  const app = Fastify({ logger: true });

  app.register(cors, { origin: true });

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

    try {
      const result = await run(req);
      void logToolCall({
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
      void logToolCall({
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
