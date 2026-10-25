/**
 * Fastify app: reference HAIP Connect agent gateway (ChatGPT Actions + MCP).
 *
 * Allow-list: search may cache ≤60s; getProperty / prepareBooking always live.
 * Cards never enter the schema — hosted paymentUrl + confirmPayment only.
 */

import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import { timingSafeEqual, randomUUID } from 'node:crypto';
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
import { AllowList, createAllowListFromEnv } from './allow-list.js';
import { handleMcpRequest, listMcpTools } from './mcp.js';

export interface AppOptions {
  adapter: HaipConnectAdapter;
  publicBaseUrl: string;
  gatewayApiKey?: string;
  allowList?: AllowList;
  defaultClientPlatform?: BookInput['clientPlatform'];
}

const PUBLIC_PATHS = new Set(['/health', '/openapi.json', '/', '/privacy']);

function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function extractCredential(req: FastifyRequest): string | null {
  const auth = req.headers['authorization'];
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) return auth.slice(7).trim();
  const key = req.headers['x-api-key'];
  if (typeof key === 'string') return key;
  if (Array.isArray(key)) return key[0] ?? null;
  return null;
}

function extractIdempotencyKey(req: FastifyRequest): string | undefined {
  const h = req.headers['idempotency-key'];
  if (typeof h === 'string' && h.trim()) return h.trim();
  if (Array.isArray(h) && h[0]) return h[0].trim();
  const body = req.body as { idempotencyKey?: string } | undefined;
  return body?.idempotencyKey?.trim() || undefined;
}

function propertyIdFromUnknown(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const o = value as Record<string, unknown>;
  if (typeof o['propertyId'] === 'string') return o['propertyId'];
  if (typeof o['sourcePropertyId'] === 'string') return o['sourcePropertyId'];
  return null;
}

export function buildApp(opts: AppOptions): FastifyInstance {
  const { adapter, publicBaseUrl } = opts;
  const allowList = opts.allowList ?? createAllowListFromEnv();
  const app = Fastify({ logger: true });

  app.register(cors, { origin: true });

  app.addHook('onRequest', async (req, reply) => {
    if (!opts.gatewayApiKey) return;
    const path = (req.url.split('?')[0] ?? req.url).replace(/\/+$/, '') || '/';
    if (PUBLIC_PATHS.has(path)) return;
    // MCP may authenticate via same gateway key on non-public methods
    if (path === '/mcp' && req.method === 'GET') return;
    const provided = extractCredential(req);
    if (!provided || !timingSafeEqualStr(provided, opts.gatewayApiKey)) {
      reply.code(401).send({ error: 'unauthorized', message: 'A valid gateway credential is required.' });
    }
  });

  app.get('/health', async () => ({
    status: 'ok',
    service: 'haip-connect-agent-gateway',
    upstreamHealthy: await adapter.upstreamHealthy(),
    timestamp: new Date().toISOString(),
  }));

  app.get('/openapi.json', async (_req, reply) => {
    reply.type('application/json').send(buildOpenApiSpec(publicBaseUrl));
  });

  app.get('/', async (_req, reply) => reply.type('text/html').send(indexHtml));
  app.get('/privacy', async (_req, reply) => reply.type('text/html').send(privacyHtml));

  app.get('/mcp', async (_req, reply) => {
    reply.send({
      name: 'haip-connect',
      transport: 'streamable-http',
      tools: listMcpTools().map((t) => t.name),
      endpoint: '/mcp',
    });
  });

  app.post('/mcp', async (req, reply) => {
    const result = await handleMcpRequest(req.body, {
      searchHotels: (input) => searchHotelsFiltered(adapter, allowList, input),
      getProperty: (id) => getPropertyGuarded(adapter, allowList, id),
      prepareBooking: (input, idem) =>
        prepareBookingGuarded(adapter, allowList, input, idem, opts.defaultClientPlatform),
      confirmPayment: (cn) => adapter.confirmPayment(cn),
      getReservation: (cn) => adapter.getReservation(cn),
      modifyReservation: (cn, body) => adapter.modifyReservation(cn, body),
      cancelReservation: (cn, reason) => adapter.cancelReservation(cn, reason),
    });
    reply.send(result);
  });

  app.post(
    '/hotels/search',
    action('searchHotels', (req) =>
      searchHotelsFiltered(adapter, allowList, req.body as SearchInput),
    ),
  );

  app.get(
    '/hotels/:propertyId',
    action('getProperty', (req) =>
      getPropertyGuarded(
        adapter,
        allowList,
        (req.params as { propertyId: string }).propertyId,
      ),
    ),
  );

  app.post(
    '/reservations',
    action(
      'prepareBooking',
      (req) =>
        prepareBookingGuarded(
          adapter,
          allowList,
          req.body as BookInput,
          extractIdempotencyKey(req),
          opts.defaultClientPlatform,
        ),
      201,
    ),
  );

  app.post(
    '/reservations/:confirmationNumber/confirm-payment',
    action('confirmPayment', (req) =>
      adapter.confirmPayment(
        (req.params as { confirmationNumber: string }).confirmationNumber,
      ),
    ),
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

async function searchHotelsFiltered(
  adapter: HaipConnectAdapter,
  allowList: AllowList,
  input: SearchInput,
): Promise<unknown> {
  if (input.propertyId) {
    const ok = await allowList.isEnabledCached(input.propertyId);
    if (!ok) {
      return { searchId: randomUUID(), totalResults: 0, results: [] };
    }
  }
  const raw = (await adapter.searchHotels(input)) as {
    results?: Array<Record<string, unknown>>;
    totalResults?: number;
    searchId?: string;
    [k: string]: unknown;
  };
  const results = Array.isArray(raw.results) ? raw.results : [];
  const enabled = await allowList.getCachedEnabledIds();
  // If allow-all sentinel (isEnabled always true with empty list), skip filter when empty+allow-all
  const filtered =
    enabled.size === 0 && process.env['ALLOW_ALL_PROPERTIES'] === 'true'
      ? results
      : results.filter((r) => {
          const id = String(r['sourcePropertyId'] ?? r['propertyId'] ?? '');
          return enabled.has(id);
        });
  return {
    ...raw,
    results: filtered,
    totalResults: filtered.length,
  };
}

async function getPropertyGuarded(
  adapter: HaipConnectAdapter,
  allowList: AllowList,
  propertyId: string,
): Promise<unknown> {
  const ok = await allowList.isPropertyEnabledLive(propertyId);
  if (!ok) {
    throw new UpstreamError(404, { error: 'not_found', message: 'Property is not on the allow-list' });
  }
  return adapter.getProperty(propertyId);
}

async function prepareBookingGuarded(
  adapter: HaipConnectAdapter,
  allowList: AllowList,
  input: BookInput,
  idempotencyKey: string | undefined,
  defaultPlatform?: BookInput['clientPlatform'],
): Promise<unknown> {
  const ok = await allowList.isPropertyEnabledLive(input.propertyId);
  if (!ok) {
    throw new UpstreamError(404, { error: 'not_found', message: 'Property is not on the allow-list' });
  }
  if (!input.guestEmail) {
    throw new UpstreamError(400, { error: 'guest_email_required', message: 'guestEmail is required' });
  }
  const key = idempotencyKey ?? input.idempotencyKey;
  if (!key) {
    throw new UpstreamError(400, {
      error: 'idempotency_key_required',
      message: 'Idempotency-Key header or idempotencyKey body field is required',
    });
  }
  return adapter.createReservation({
    ...input,
    idempotencyKey: key,
    paymentMethod: 'hosted_checkout',
    clientPlatform: input.clientPlatform ?? defaultPlatform ?? 'chatgpt',
    agentId: process.env['HAIP_AGENT_ID'] ?? 'HAIP_AGENT',
  });
}

function action(
  tool: string,
  run: (req: FastifyRequest) => Promise<unknown>,
  successStatus = 200,
) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const start = Date.now();
    const sessionId = sessionFrom(req);
    const requestPayload = { params: req.params, query: req.query, body: req.body };
    const propertyId =
      propertyIdFromUnknown(req.params) ??
      propertyIdFromUnknown(req.body) ??
      null;

    try {
      const result = await run(req);
      await logToolCall({
        tool,
        sessionId,
        propertyId,
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
        propertyId,
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

function sessionFrom(req: FastifyRequest): string | null {
  const raw = req.headers['openai-ephemeral-user-id'] ?? req.headers['x-session-id'];
  if (Array.isArray(raw)) return raw[0] ?? null;
  return (raw as string | undefined) ?? null;
}
