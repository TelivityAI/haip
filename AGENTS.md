# AGENTS.md

Project domain rules and code standards live in `CLAUDE.md`. Standard dev/build/test
commands live in `README.md` (see "Local development" and "Run tests"). This file
captures only the non-obvious operating notes for running HAIP inside the Cursor
Cloud VM.

## Cursor Cloud specific instructions

This VM has **no Docker**. The `docker compose` quick-start in the README does not
apply here. Postgres 16 and Redis are installed on the host (via apt) instead of
in containers, and are captured in the VM snapshot. Node 22 + pnpm 9 are preinstalled.

The update script only runs `pnpm install`. Everything below (starting services,
env files, building packages, migrate/seed) is a per-session startup step, not part
of the update script.

### Start infra each session (systemd is not running)

```bash
sudo pg_ctlcluster 16 main start
sudo redis-server --daemonize yes --dir /var/lib/redis
redis-cli ping    # -> PONG
```

Postgres has role `haip` / password `haip` and databases `haip` (dev) and
`haip_test` (tests) already created. Connection string:
`postgresql://haip:haip@localhost:5432/haip`.

### Env files (gitignored, live only in the snapshot)

`.env` (repo root) and `apps/api/.env` are copies of `.env.example`. If either is
missing, recreate with `cp .env.example .env` and `cp .env.example apps/api/.env`.

- **Gotcha:** the API dev server (`pnpm dev`) runs with its cwd at `apps/api/`, and
  its NestJS `ConfigModule` loads `.env` **relative to that cwd** — so it reads
  `apps/api/.env`, NOT the repo-root `.env`. Without `apps/api/.env`, `AUTH_ENABLED`
  falls back to the secure default `true` and every non-`@Public` endpoint returns
  `401 "No auth token"` (health still works). The auth-off demo needs
  `AUTH_ENABLED=false`, which lives in that file.

### Build before running or testing

Workspace packages must be built at least once so the API and tests can resolve
`@telivityhaip/shared` and `@telivityhaip/database` (they import from `dist/`):

```bash
pnpm build
```

Migrate + seed the dev DB (idempotent):

```bash
pnpm db:migrate
pnpm seed
```

### Services and how to run them

| Service | Command | URL |
|---------|---------|-----|
| API (NestJS, hot reload) | `pnpm dev` | http://localhost:3000 (Swagger at `/docs`, health at `/api/v1/health`) |
| Dashboard (Vite) | `pnpm --filter @telivityhaip/dashboard dev` | http://localhost:5173 |
| Booking widget (Vite) | `pnpm --filter @telivityhaip/booking dev` | http://localhost:5174 |

The dashboard dev server proxies `/api` → `http://localhost:3000`, so the API must
be running for the dashboard to load data. The demo property id is
`a0000001-0000-4000-a000-000000000001`.

### Tests

Tests need Postgres + Redis and run against `haip_test` (push its schema once with
`DATABASE_URL=postgresql://haip:haip@localhost:5432/haip_test pnpm db:migrate`):

```bash
DATABASE_URL=postgresql://haip:haip@localhost:5432/haip_test \
  REDIS_URL=redis://localhost:6379 CI=true pnpm test
```

`pnpm lint` and `pnpm typecheck` need no services. Lint currently emits many
warnings but 0 errors; that is expected and not a failure.
