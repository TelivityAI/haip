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

On each release, GitHub Actions publishes a **multi-platform** image (`linux/amd64` and `linux/arm64`):

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

## VPS self-host (Ubuntu)

Minimal path for a single VM (Hetzner, DigitalOcean, Linode, AWS EC2, etc.).

1. **Provision** an Ubuntu 22.04/24.04 host with at least 2 vCPU / 4 GB RAM (8 GB recommended if Keycloak runs on the same box).
2. **Install Docker** (official docs): Engine + Compose plugin. Confirm with `docker compose version`.
3. **Clone and configure:**
   ```bash
   git clone https://github.com/TelivityAI/haip.git
   cd haip
   cp .env.production.example .env.production
   # Fill DATABASE_URL / REDIS_URL if overriding compose defaults,
   # Stripe keys, CONNECT_API_KEY, CORS_ORIGINS, strong Keycloak admin password.
   ```
4. **Firewall:** allow `22`, `80`, `443` only. Do **not** expose Postgres (`5432`), Redis (`6379`), or Keycloak (`8080`) publicly — terminate TLS on the host and proxy to the API on `127.0.0.1:3000` (or a private Docker network).
5. **Start production stack:**
   ```bash
   docker compose -f docker-compose.yml -f docker-compose.prod.yml --profile auth up -d --build
   ```
6. **TLS:** point DNS at the VPS and put Caddy or nginx in front (see [TLS termination](#tls-termination)). Set `CORS_ORIGINS=https://pms.example.com` if the browser origin differs from the API host.
7. **Cron:** schedule night audit / group cutoffs from the host using [`scripts/cron/`](../scripts/cron/) and [`docs/operations/cron.md`](./operations/cron.md).
8. **Backups:** nightly `pg_dump` of `DATABASE_URL` off-box (see [Database backup and restore](#database-backup-and-restore)).

Alternatively, skip building on the VPS and pull the GHCR image, then run compose with an override that sets `image: ghcr.io/telivityai/haip-api:latest` for the `api` service (still need Postgres, Redis, Keycloak, and the `init` migrate step).

## Cloud deployment options

These are sketches for running the **published GHCR image** (or the production compose overlay) on common platforms. HAIP expects Postgres, Redis, and (for auth-on) Keycloak — use managed addons where the platform provides them.

### Render

| Mode | What to use |
|------|-------------|
| **Demo** (auth off) | One-click [`render.yaml`](../render.yaml) blueprint from the README — intentionally insecure for try-out only (`HAIP_ALLOW_INSECURE=true`). |
| **Production** | Do **not** use the demo blueprint as-is. Create a **Web Service** from `ghcr.io/telivityai/haip-api:<tag>` (or Dockerfile), attach **managed Postgres** + **Redis**, set `AUTH_ENABLED=true`, `NODE_ENV=production`, real Stripe keys, `CONNECT_API_KEY`, and `CORS_ORIGINS`. Run Keycloak as a separate private service (or external IdP) and never set `HAIP_ALLOW_INSECURE`. Run migrate via a one-off job (`node packages/database/dist/push-schema.js`) before switching traffic. |

### Railway

1. Create a project with **Postgres** and **Redis** plugins; copy their connection URLs into service variables.
2. Deploy the API from the GitHub repo (Railway builds [`apps/api/Dockerfile`](../apps/api/Dockerfile)) **or** deploy from `ghcr.io/telivityai/haip-api:<tag>`.
3. Set production env vars from [`.env.production.example`](../.env.production.example): `AUTH_ENABLED=true`, `NODE_ENV=production`, Stripe, `CONNECT_API_KEY`, Keycloak URL/realm/client, `SERVE_DASHBOARD=true`, `SERVE_BOOKING=true`.
4. Add Keycloak as another Railway service (or point at an external realm). Restrict public networking to the API only.
5. Run schema migration once (Railway one-off / release command) before serving traffic.

### AWS

Typical pattern: **ECS Fargate** (or EC2 + Docker) for `ghcr.io/telivityai/haip-api`, **RDS Postgres**, **ElastiCache Redis**, and Keycloak on ECS or a managed OIDC provider.

1. Push/pull the multi-arch GHCR image into the account (or mirror to ECR).
2. Task definition: port `3000`, secrets from SSM/Secrets Manager for `DATABASE_URL`, `REDIS_URL`, Stripe, Connect keys.
3. ALB + ACM certificate for TLS; security groups so only the ALB reaches the task.
4. Run migrate as a one-off ECS task (`node packages/database/dist/push-schema.js`) on each upgrade before rolling the service.
5. Schedule night-audit / cutoff cron via EventBridge → authenticated HTTPS calls (see [`docs/operations/cron.md`](./operations/cron.md)).

### GCP

Typical pattern: **Cloud Run** for the API image, **Cloud SQL (Postgres)**, **Memorystore (Redis)**, Keycloak on Cloud Run/GKE or external OIDC.

1. Deploy `ghcr.io/telivityai/haip-api:<tag>` to Cloud Run (allow unauthenticated only if a proxy/IAP sits in front; otherwise keep the service private and expose via HTTPS load balancer).
2. Wire `DATABASE_URL` / `REDIS_URL` via Secret Manager; set `AUTH_ENABLED=true` and the rest of the production env table above.
3. Cloud Run min instances ≥ 1 if you need warm WebSocket / cron targets.
4. Run migrate from Cloud Run Jobs (same `push-schema` entrypoint) on deploy.
5. Use Cloud Scheduler for night audit / group cutoff HTTPS jobs.

## Booking widget with auth on

When `AUTH_ENABLED=true`, the public booking engine requires a per-property **booking key** (`x-booking-key` header or `?key=` query param). Generate or rotate keys in the dashboard under **Settings → Booking Engine**.
