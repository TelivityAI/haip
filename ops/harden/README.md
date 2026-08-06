# HAIP operator harden pack

Playbooks and a small CLI so operators can harden a **self-hosted HAIP**
deployment (Keycloak + docker compose) before go-live and against a live URL.

## What this is

| Piece | Purpose |
|-------|---------|
| [`CHECKLIST.md`](./CHECKLIST.md) | Production go-live checklist |
| [`TENANT_ISOLATION.md`](./TENANT_ISOLATION.md) | Cross-tenant deny criteria (Keycloak JWTs) |
| [`SURFACE_SMOKE.md`](./SURFACE_SMOKE.md) | Full SPA surface walk before chargeable use |
| [`vignettes/`](./vignettes/) | Desk ops stories (guest → staff → delight/block) |
| [`cli/`](./cli/) | `harden:local` and `harden:live` HTTP probes |

## Quick start

### Pre-go-live (local / compose)

From the HAIP repo root:

```bash
# 1. Configure production env
cp .env.production.example .env.production
# Edit .env.production — AUTH_ENABLED=true, Stripe, CONNECT_API_KEY, etc.

# 2. Bring up the prod overlay (auth on)
docker compose -f docker-compose.yml -f docker-compose.prod.yml --profile auth up -d --build

# 3. Static + HTTP local checks
pnpm harden:local
```

Then walk [`SURFACE_SMOKE.md`](./SURFACE_SMOKE.md) and a few [`vignettes/`](./vignettes/) against the dashboard.

### Live instance

```bash
cp ops/harden/.env.harden.example .env.harden
# Fill HAIP_API_BASE, TOKEN_A, TOKEN_B, PROPERTY_A, PROPERTY_B

set -a && source .env.harden && set +a
pnpm harden:live
```

Exit code `0` = all probes passed; non-zero = at least one fail. See the printed table.

## Keycloak tokens

Tokens must be JWTs issued by your Keycloak realm (`haip` by default) for the
API client (`haip-api`). Claims the API expects:

| Claim | Meaning |
|-------|---------|
| `property_ids` | Array of property UUIDs this user may access |
| `roles` | HAIP roles (e.g. `admin`, `front_desk`, `readonly`) |

**User A** should have `property_ids=[PROPERTY_A]` only.  
**User B** should have `property_ids=[PROPERTY_B]` only.

How you mint tokens (password grant, client credentials + user impersonation,
or your IdP’s token endpoint) is up to your deployment — the CLI only needs the
bearer strings.

`HAIP_API_BASE` is the API origin **including** `/api` if your reverse proxy
serves the API under `/api` (compose default: `http://localhost:3000/api`).
Probes call `{HAIP_API_BASE}/v1/...`.

## Modes

| Command | Needs running stack? | Needs tokens? |
|---------|----------------------|---------------|
| `pnpm harden:local` | Preferred (for HTTP checks); file checks always run | Optional — if tokens are set, also runs live probes against local base |
| `pnpm harden:live` | Yes (your URL) | **Required** |

## Manual ops (after CLI green)

1. Complete [`SURFACE_SMOKE.md`](./SURFACE_SMOKE.md) on property A.
2. Run several vignettes from [`vignettes/`](./vignettes/) (start with `base-01`, `base-07`, `base-15`).
3. Re-run `pnpm harden:live` after any auth or multi-tenancy change.

## Non-goals

- Automated full-SPA Playwright campaigns (use surface smoke + vignettes manually in v1)
- Exhaustive penetration testing — this pack is an operator readiness gate, not a red-team suite
