# HAIP integration demos

One folder per **shipped** integration. Each demo turns the Integrations toggle **ON** (same as the dashboard button) and wires the demo path — **mock/console when you have no vendor keys**.

## Prerequisites

```bash
docker compose up
# API at http://localhost:3000 — demo property is seeded automatically
```

## One command

```bash
# List shipped demos
./integrations/demos/run.sh list

# Enable + demo one integration
./integrations/demos/run.sh stripe
./integrations/demos/run.sh beds24
./integrations/demos/run.sh serbia-suf-esir

# Enable every shipped catalog toggle
./integrations/demos/run.sh enable-all

# Run every demo pack
./integrations/demos/run.sh all
```

Or via pnpm:

```bash
pnpm integrations:demo -- list
pnpm integrations:demo -- stripe
pnpm integrations:demo -- all
```

## What “easy” means here

| Step | What happens |
|------|----------------|
| 1 | `PUT /api/v1/admin/integrations/:slug` — property toggle ON |
| 2 | Provider-specific wiring (channel connection, fiscal config, or env hints) |
| 3 | Without paid credentials → **console/mock** (logged stub, no vendor HTTP) |
| 4 | With credentials in env / connection config → same commands go live after API restart when the provider is process-selected |

Dashboard equivalent: open **Integrations**, flip the switch for that row.

## Shipped demos

| Slug | Kind |
|------|------|
| `stripe` | Payment (mock by default) |
| `adyen` / `mollie` / `square` / `braintree` | Payment (console without keys) |
| `beds24` / `channex` | Channel connection |
| `pmsxchange-siteminder` / `derbysoft-property-connector` | Channel (+ optional `docker compose --profile channels`) |
| `nuki` / `ttlock` / `salto-ks` | Door locks |
| `infobip-omnichannel` / `vonage-messages` / `bird` / `telegram-bot` | Messaging |
| `sendgrid` | Email |
| `google-business-profile-reviews` / `tripadvisor-content-api` | Reviews |
| `serbia-suf-esir` / `serbia-eturista` | Fiscal / guest registration |

Each slug folder has `demo.sh`, `demo.env.example`, and a short `README.md`.

## Env overrides

```bash
export HAIP_URL=http://localhost:3000
export PROPERTY_ID=a0000001-0000-4000-a000-000000000001
```

## Planned integrations (the other ~136)

Those need partner apps / certs / authority clients — they are **not** in this folder until they are `shipped` or have a console `adapter` demo. See [Wave 3 partner surface](../../docs/integrations/wave3-partner-surface.md) and [catalog status](../../docs/INTEGRATIONS.md#catalog-status-registry).

## Recipes (no vendor SDK)

Webhook / CSV / SQL recipes stay under [`docs/integrations/`](../../docs/integrations/) (`webhooks-zapier`, `accounting-csv`, `bi-postgres`, …) — already one-copy paste, no demo folder required.
