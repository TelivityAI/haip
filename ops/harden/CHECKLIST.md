# Production go-live checklist

Use this before exposing HAIP to real guests or chargeable traffic.
Details: [`docs/deployment.md`](../../docs/deployment.md) and
[`.env.production.example`](../../.env.production.example).

## Compose & boot

- [ ] Copied `.env.production.example` → `.env.production` and filled secrets
- [ ] Started with prod overlay + auth profile:
  ```bash
  docker compose -f docker-compose.yml -f docker-compose.prod.yml --profile auth up -d --build
  ```
- [ ] `AUTH_ENABLED=true` (required in production)
- [ ] `HAIP_ALLOW_INSECURE` is **unset / empty** (never `true` in production)
- [ ] `STRIPE_MODE` is `test` until ready for real charges; then `live` with live keys
- [ ] API boots cleanly; `GET /api/v1/health` returns `status: ok`

## Auth (Keycloak)

- [ ] Keycloak runs in production mode with TLS (not `start-dev` exposed publicly)
- [ ] Strong Keycloak admin credentials (changed from defaults)
- [ ] Realm `haip` (or your realm) issues JWTs with `property_ids` and `roles`
- [ ] Unauthenticated `GET /api/v1/reservations?propertyId=<uuid>` → **401**
- [ ] Dashboard built / served with auth on (`VITE_AUTH_ENABLED=true` in prod overlay)

## Multi-tenancy

- [ ] At least two test properties exist
- [ ] User A JWT has only property A; user B only property B
- [ ] `pnpm harden:live` passes tenant-isolation probes (see [`TENANT_ISOLATION.md`](./TENANT_ISOLATION.md))
- [ ] SPA routes always include `propertyId` on detail pages

## Payments & Connect

- [ ] Stripe secret + webhook secret match `STRIPE_MODE`
- [ ] Stripe webhook endpoint receives events (signature verified)
- [ ] `CONNECT_API_KEY` set when auth is on (OTAIP / Connect agents)
- [ ] Booking engine keys generated under Settings → Booking Engine (when auth on)

## Network & ops

- [ ] TLS terminated at reverse proxy (Caddy/nginx/etc.)
- [ ] `CORS_ORIGINS` set if browser origin ≠ API host
- [ ] Night audit / group cutoff cron configured ([`docs/operations/cron.md`](../../docs/operations/cron.md))
- [ ] Database backup + restore tested once
- [ ] Rate limiting considered for public origins

## Product smoke (manual)

- [ ] [`SURFACE_SMOKE.md`](./SURFACE_SMOKE.md) completed on property A — zero Critical on check-in, rooms, folios, night audit, housekeeping
- [ ] At least three desk [`vignettes/`](./vignettes/) exercised (recommend `base-01`, `base-07`, `base-15`)

## Gate

Do **not** put real hotel traffic on the instance while Critical surface failures or failed tenant-isolation probes remain open.
