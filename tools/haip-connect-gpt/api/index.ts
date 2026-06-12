/**
 * Vercel serverless entrypoint.
 *
 * `vercel.json` rewrites every path to this single function, which forwards the
 * request into the same Fastify app used for local/Node hosting. The business
 * logic (adapter, OpenAPI, scrub, logging) is unchanged — this is only the boot
 * shim for serverless. Imports come from ../dist (produced by `npm run build`),
 * so Vercel bundles plain compiled JS.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { HaipConnectAdapter } from '../dist/haip-connect-adapter.js';
import { buildApp } from '../dist/app.js';

// Serverless boots leniently: a config-less first deploy must still serve
// /openapi.json, /privacy, and /health so the ChatGPT Action can be wired up
// (Stage A). Action routes will simply return an upstream error until
// HAIP_API_BASE_URL points at a reachable HAIP API (Stage B). The long-running
// server (server.ts) stays strict and fails loudly on missing config.
const baseUrl = process.env['HAIP_API_BASE_URL'] ?? 'https://haip-not-configured.invalid';
const apiKey = process.env['HAIP_CONNECT_API_KEY'] ?? 'unconfigured';

// Prefer an explicit PUBLIC_BASE_URL; otherwise fall back to the Vercel-provided
// production/deployment domain so the OpenAPI `servers[0].url` is correct.
const publicBaseUrl =
  process.env['PUBLIC_BASE_URL'] ??
  (process.env['VERCEL_PROJECT_PRODUCTION_URL']
    ? `https://${process.env['VERCEL_PROJECT_PRODUCTION_URL']}`
    : process.env['VERCEL_URL']
      ? `https://${process.env['VERCEL_URL']}`
      : '');

const app = buildApp({
  adapter: new HaipConnectAdapter({ baseUrl, apiKey }),
  publicBaseUrl,
});
const ready = app.ready();

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  await ready;
  app.server.emit('request', req, res);
}
