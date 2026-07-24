# HAIP integration demos

One folder per **shipped** integration and every **adapter** (console) pack. Each demo turns the Integrations toggle **ON** (same as the dashboard button) and wires the demo path.

| Kind | Count | What “demo” means |
|------|------:|-------------------|
| **shipped** | 21 | In-product path. Demo enables it and uses **mock/console** until you add live keys. |
| **adapter** | 37 | Console fiscal/guest-reg provider key. Demo sets the key and logs handoffs — **not** live authority filing. |
| **Total** | **58** | `./integrations/demos/run.sh list` |

Recipes (Zapier webhooks, CSV, BI Postgres, …) stay under [`docs/integrations/`](../../docs/integrations/) — copy-paste, no demo folder.

## Prerequisites

```bash
docker compose up
# API at http://localhost:3000 — demo property is seeded automatically
```

## One command

```bash
./integrations/demos/run.sh list           # all 58
./integrations/demos/run.sh list shipped   # 21 product paths
./integrations/demos/run.sh list adapters  # 37 console country packs

./integrations/demos/run.sh stripe         # one slug
./integrations/demos/run.sh fiskaly-sign-at
./integrations/demos/run.sh all            # every demo
./integrations/demos/run.sh all shipped
./integrations/demos/run.sh enable-all     # catalog toggles only
```

```bash
pnpm integrations:demo -- list shipped
pnpm integrations:demo -- beds24
```

## What you get vs “working perfectly”

### Shipped (payments, channels, locks, SMS, …)

| Step | Demo does this | You do this for live |
|------|----------------|----------------------|
| 1 | `PUT …/admin/integrations/:slug` → toggle ON | (already done by demo / dashboard) |
| 2 | Creates channel connection or prints env | Paste real keys into `.env` or connection `config` |
| 3 | Works in **mock/console** with no keys | Restart API if the provider is process-selected (`PAYMENT_GATEWAY`, `SMS_PROVIDER`, `DOOR_LOCK_PROVIDER`) |
| 4 | Prints live env var names | Run a real charge / SMS / lock / ARI push once |

Each shipped folder has:
- `demo.sh` — one command
- `demo.env.example` — copy into `.env`
- `README.md` — short path
- **`GO_LIVE.md`** — checklist to go from mock → production in minutes

### Adapter (fiscal / guest-reg console packs)

| Step | Demo does this | You do this for live filing |
|------|----------------|-----------------------------|
| 1 | Toggle ON | — |
| 2 | `PUT /fiscal/config` with the provider key | Keep the same key |
| 3 | Core **logs** a fake acknowledgement | Replace console provider with a real authority/partner client |
| 4 | — | Check-in / invoice and confirm a real external id |

**Adapter demos are wiring demos**, not “tax authority connected.” Marking them live without credentials would be a lie.

## Env overrides

```bash
export HAIP_URL=http://localhost:3000
export PROPERTY_ID=a0000001-0000-4000-a000-000000000001
```

## Planned (~136)

No demos until `shipped` or `adapter`. See [Wave 3 partner surface](../../docs/integrations/wave3-partner-surface.md).
