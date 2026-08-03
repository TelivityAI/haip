# HAIP integration demos

One folder per catalog integration that is **shipped**, **adapter**, or **recipe**. Each demo turns the Integrations toggle **ON** (same as the dashboard button) and exercises the honest demo path (mock/console/docs recipe) without inventing vendor APIs.

| Kind | Count | What “demo” means |
|------|------:|-------------------|
| **shipped** | 24 | In-product path. Demo enables it and uses **mock/console** until you add live keys. |
| **adapter** | 58 | Console provider/adapter key. Demo wires the key and logs handoffs — **not** live partner/authority traffic. |
| **recipe** | 26 | Docs + existing REST/webhooks/CSV/SQL. Demo enables the catalog row and points at the recipe. |
| **Total** | **108** | `./integrations/demos/run.sh list` |

## Prerequisites

```bash
docker compose up
# API at http://localhost:3000 — demo property is seeded automatically
```

## One command

```bash
./integrations/demos/run.sh list              # all 108
./integrations/demos/run.sh list shipped      # 24 product paths
./integrations/demos/run.sh list adapters     # 58 console packs
./integrations/demos/run.sh list recipes      # 26 recipe rows

./integrations/demos/run.sh stripe            # one slug
./integrations/demos/run.sh yieldplanet
./integrations/demos/run.sh mailchimp
./integrations/demos/run.sh all               # every demo
./integrations/demos/run.sh all shipped
./integrations/demos/run.sh enable-all        # catalog toggles only
```

```bash
pnpm integrations:demo -- list shipped
pnpm integrations:demo -- beds24
```

## What you get vs “working perfectly”

### Shipped (payments, channels, locks, SMS, email, …)

| Step | Demo does this | You do this for live |
|------|----------------|----------------------|
| 1 | `PUT …/admin/integrations/:slug` → toggle ON | (already done by demo / dashboard) |
| 2 | Creates channel connection or prints env | Paste real keys into `.env` or connection `config` |
| 3 | Works in **mock/console** with no keys | Restart API if the provider is process-selected (`PAYMENT_GATEWAY`, `SMS_PROVIDER`, `DOOR_LOCK_PROVIDER`, …) |
| 4 | Prints live env var names | Run a real charge / SMS / lock / ARI push once |

Each shipped folder has:
- `demo.sh` — one command
- `demo.env.example` — copy into `.env`
- `README.md` — short path
- **`GO_LIVE.md`** — checklist to go from mock → production

### Adapter (console packs)

| Step | Demo does this | You do this for live |
|------|----------------|----------------------|
| 1 | Toggle ON | — |
| 2 | Wires channel / fiscal / review / payment console key | Keep the same key / `adapterType` / `source` |
| 3 | Core **logs** a handoff | Replace console implementation with a real partner/authority client |
| 4 | — | Confirm a real external id / ARI push / review pull |

**Adapter demos are wiring demos**, not “vendor connected.”

### Recipe (BI, accounting CSV, POS inbound, CRM webhooks, FX)

| Step | Demo does this | You do this for live |
|------|----------------|----------------------|
| 1 | Toggle ON | — |
| 2 | Points at existing docs (`docs/integrations/*`) | Follow the recipe (Postgres role, CSV import, Connect subscription, …) |
| 3 | No Nest vendor client | Vendor keys live only in your middleware / BI tool |

## Env overrides

```bash
export HAIP_URL=http://localhost:3000
export PROPERTY_ID=a0000001-0000-4000-a000-000000000001
```

## Wave 3 Tier A/B (50)

| Slice | Maturity | Count | Docs |
|-------|----------|------:|------|
| Messaging + email | shipped | 3 | [whatsapp-cloud](../../docs/integrations/whatsapp-cloud.md), [mailgun-ses](../../docs/integrations/mailgun-ses.md) |
| Channels + Wise | adapter | 12 | [wave3-channels-wise](../../docs/integrations/wave3-channels-wise.md) |
| Reviews | adapter | 9 | [wave3-reviews](../../docs/integrations/wave3-reviews.md) |
| BI / accounting / POS / CRM / FX | recipe | 26 | [bi-postgres](../../docs/integrations/bi-postgres.md), [accounting-csv](../../docs/integrations/accounting-csv.md), [folio-inbound-pos](../../docs/integrations/folio-inbound-pos.md), [crm-webhooks](../../docs/integrations/crm-webhooks.md), [frankfurter-ecb-fx](../../docs/integrations/frankfurter-ecb-fx.md) |

Remaining partner/cert rows stay `planned` — see [Wave 3 partner surface](../../docs/integrations/wave3-partner-surface.md).
