# HAIP Production Deployment

This guide covers self-hosting HAIP with authentication enabled and secure defaults.
For the zero-config local demo, see [Quick Start](../README.md#quick-start) in the README.

## Compose files

| File | Purpose |
|------|---------|
| [`docker-compose.yml`](../docker-compose.yml) | Default **demo** stack — auth off, `STRIPE_MODE=mock`, `HAIP_ALLOW_INSECURE=true` |
| [`docker-compose.auth.yml`](../docker-compose.auth.yml) | Optional overlay — explore Keycloak login with `--profile auth` |
| [`docker-compose.prod.yml`](../docker-compose.prod.yml) | **Production** overlay — `AUTH_ENABLED=true`, no insecure flag, `STRIPE_MODE=test` |

### Demo (one command)

```bash
docker compose up -d --build
```

Serves dashboard, booking widget (`/booking/`), and API at `http://localhost:3000`. Auth is **off** by default.

### Explore auth locally

```bash
docker compose -f docker-compose.yml -f docker-compose.auth.yml --profile auth up -d --build
```

- API enforces JWT (`AUTH_ENABLED=true`)
- Dashboard SPA is built with `VITE_AUTH_ENABLED=true` and redirects to Keycloak
- Keycloak admin: `http://localhost:8080` (default `admin` / `admin` — change immediately)

Unauthenticated requests to protected API routes return **401**, e.g.:

```bash
curl -s -o /dev/null -w "%{http_code}" \
  "http://localhost:3000/api/v1/reservations?propertyId=a0000001-0000-4000-a000-000000000001"
# 401
```

### Production self-host

```bash
cp .env.production.example .env.production
# Edit .env.production — fill Stripe keys, CONNECT_API_KEY, CORS, storage, etc.

docker compose -f docker-compose.yml -f docker-compose.prod.yml --profile auth up -d --build
```

Services: **postgres**, **redis**, **keycloak** (`--profile auth`), **init** (migrate + seed), **api**.

The API refuses to boot in `NODE_ENV=production` when `AUTH_ENABLED=false` or `STRIPE_MODE=mock`, unless `HAIP_ALLOW_INSECURE=true` (demo only — never set in production).

Validate compose config before deploying:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml config
```

## Required environment variables

Copy [`.env.production.example`](../.env.production.example) to `.env.production`. At minimum:

| Variable | Required | Notes |
|----------|----------|-------|
| `DATABASE_URL` | Yes | Postgres connection string |
| `REDIS_URL` | Yes | Redis for cache, queues, pub/sub |
| `AUTH_ENABLED` | Yes | Must be `true` in production |
| `KEYCLOAK_URL` | Yes | Internal URL (`http://keycloak:8080` in compose) |
| `KEYCLOAK_REALM` | Yes | Default `haip` |
| `KEYCLOAK_CLIENT_ID` | Yes | API client, default `haip-api` |
| `CONNECT_API_KEY` | Yes when auth on | Comma-separated keys for OTAIP Connect API |
| `STRIPE_MODE` | Yes | `test` for staging, `live` for real charges |
| `STRIPE_SECRET_KEY` | Yes | Stripe secret key matching mode |
| `STRIPE_WEBHOOK_SECRET` | Yes | Webhook signing secret |
| `SERVE_DASHBOARD` | Recommended | Serve bundled dashboard at `/` |
| `SERVE_BOOKING` | Recommended | Serve booking widget at `/booking/` |
| `CORS_ORIGINS` | If cross-origin | Comma-separated browser origins; omit for same-origin |
| `STORAGE_DRIVER` | If uploads | `s3` with bucket credentials, or `local` |

**Keycloak (production notes):** The base compose file runs Keycloak in `start-dev` mode for local exploration. For real deployments, run Keycloak in production mode with TLS, strong admin credentials, and a managed Postgres database — do not expose port 8080 publicly without a reverse proxy.

**Stripe:** Production overlay sets `STRIPE_MODE=test` by default. Switch to `live` and live keys only when ready to accept real payments.

## TLS termination

Terminate TLS at a reverse proxy in front of the API container (port 3000). Example **Caddy** site block:

```caddyfile
pms.example.com {
    reverse_proxy haip-api:3000
}
```

Example **nginx**:

```nginx
server {
    listen 443 ssl;
    server_name pms.example.com;
    ssl_certificate     /etc/ssl/certs/pms.crt;
    ssl_certificate_key /etc/ssl/private/pms.key;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Set `CORS_ORIGINS=https://pms.example.com` when the browser calls the API from a different hostname.

## Scheduled jobs (cron)

Night audit, group block cutoffs, and agent training run via **external cron** hitting authenticated API endpoints. See [`docs/operations/cron.md`](./operations/cron.md) and [`scripts/cron/`](../scripts/cron/).

## Database backup and restore

Backup (run from a host with `pg_dump` access):

```bash
pg_dump "$DATABASE_URL" -Fc -f haip-$(date +%Y%m%d).dump
```

Test restore on staging before relying on backups:

```bash
pg_restore -d "$STAGING_DATABASE_URL" --clean --if-exists haip-YYYYMMDD.dump
```

## Upgrades

1. **Backup** the database (`pg_dump` above).
2. Pull the new image (or rebuild).
3. Run schema migration **before** switching traffic:
   ```bash
   docker compose -f docker-compose.yml -f docker-compose.prod.yml run --rm init \
     sh -c "node packages/database/dist/push-schema.js"
   ```
4. Restart the API: `docker compose ... up -d api`.

The `init` service is idempotent — safe to re-run on every deploy.

## Container images (GHCR)

On each release, GitHub Actions publishes:

```
ghcr.io/telivityai/haip-api:<tag>
ghcr.io/telivityai/haip-api:latest
```

Pull and run (supply your own `.env.production` and Postgres/Redis/Keycloak):

```bash
docker pull ghcr.io/telivityai/haip-api:latest
docker run --env-file .env.production -p 3000:3000 ghcr.io/telivityai/haip-api:latest
```

For the full stack (Postgres, Redis, Keycloak, migrate/seed), use the compose files above rather than a bare `docker run`.

## Booking widget with auth on

When `AUTH_ENABLED=true`, the public booking engine requires a per-property **booking key** (`x-booking-key` header or `?key=` query param). Generate or rotate keys in the dashboard under **Settings → Booking Engine**.
