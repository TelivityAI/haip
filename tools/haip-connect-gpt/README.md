# HAIP Connect GPT gateway

A thin, standalone gateway that exposes HAIP hotel search and booking as a **ChatGPT
Custom GPT Action**. It mirrors the OTAIP/Ligare pattern: wrap a domain engine, expose
it to ChatGPT as tools via an OpenAPI spec, host a tiny backend, and log every tool call
for training.

HAIP's "domain engine" is its already-built **Connect API** (`/api/v1/connect/*`). This
gateway is a typed HTTP client over it — it does **not** reimplement hotel logic.

```
ChatGPT  ──HTTPS──▶  this gateway  ──x-api-key──▶  HAIP Connect API (/api/v1/connect/*)
                         │
                         └──▶ Supabase (haip_tool_calls)   # PII-scrubbed tool-call log
```

## Why a separate service

- The gateway holds HAIP's `x-api-key` and injects it server-side — **the GPT never sees it**.
- The public AI surface (6 hotel operations) stays decoupled from HAIP's internal API.
- Responses are guarded so **only selling prices** ever reach the GPT (no net/wholesale/cost).

## Pieces

| File | Role |
| --- | --- |
| `src/haip-connect-adapter.ts` | Uniform hotel methods → HTTP calls to `/api/v1/connect/*` |
| `src/openapi.ts` | Builds the ChatGPT-importable OpenAPI 3.1 spec |
| `src/app.ts` / `src/server.ts` | Fastify backend: actions + `/openapi.json` + `/health` + `/privacy` |
| `src/events.ts` | Logs each tool call to Postgres (`haip_tool_calls` in the haip-demo Supabase project) |
| `src/scrub.ts` | PII redaction (for logs) + net-rate stripping (for responses) |
| `src/pages.ts` | Inlined landing + privacy HTML (no disk reads — portable to serverless) |
| `api/index.ts` | Vercel serverless entrypoint (wraps the same Fastify app) |

## Endpoints

| Method | Path | Tool |
| --- | --- | --- |
| POST | `/hotels/search` | `searchHotels` |
| GET | `/hotels/{propertyId}` | `getProperty` |
| POST | `/reservations` | `createReservation` |
| GET | `/reservations/{confirmationNumber}` | `getReservation` |
| PATCH | `/reservations/{confirmationNumber}` | `modifyReservation` |
| DELETE | `/reservations/{confirmationNumber}` | `cancelReservation` |

Plus `GET /openapi.json`, `GET /health`, `GET /privacy`, `GET /`.

## Run locally

```bash
cd tools/haip-connect-gpt
cp .env.example .env        # fill in HAIP_CONNECT_API_KEY and (optionally) Supabase keys
npm install
npm run dev                 # tsx watch
```

Point `HAIP_API_BASE_URL` at a running HAIP API (e.g. `http://localhost:3000` after
`pnpm --filter @telivityhaip/api dev` and seeding). Then:

```bash
curl localhost:8080/health
curl localhost:8080/openapi.json | head
curl -X POST localhost:8080/hotels/search \
  -H 'content-type: application/json' \
  -d '{"city":"New York","checkIn":"2026-06-01","checkOut":"2026-06-03","adults":2}'
```

## Test

```bash
npm test        # vitest: scrub redaction + net-rate guard, adapter routing/errors
npm run build   # tsc typecheck + emit
```

## Deploy (Vercel)

This package deploys to Vercel as a single serverless function. `vercel.json` runs the
build and rewrites all routes to `api/index.ts`, which forwards into the same Fastify app.
Set these environment variables on the Vercel project:

- `HAIP_API_BASE_URL` — your public HAIP API URL
- `HAIP_CONNECT_API_KEY` — matches HAIP's `CONNECT_API_KEY`
- `PUBLIC_BASE_URL` — optional; the production domain for the OpenAPI server URL
  (auto-derived from the Vercel deployment domain if unset)
- `TOOL_LOG_DATABASE_URL` — haip-demo Postgres connection string (logging; optional)

> The gateway can also run as a plain long-running Node server (`npm run start`) or in a
> container (`Dockerfile`) for non-serverless hosts — the core code is host-agnostic.

## Publish the GPT

See [`CHATGPT-GPT.md`](./CHATGPT-GPT.md) for the GPT name, description, instructions, and
the import steps (import the Action from `PUBLIC_BASE_URL/openapi.json`, set the privacy
URL to `PUBLIC_BASE_URL/privacy`).
