# HAIP scheduled jobs (cron)

HAIP has no in-process scheduler. Run these scripts from **system cron**, Kubernetes CronJob, or similar.

Full endpoint reference: [`docs/operations/cron.md`](../../docs/operations/cron.md).

## Authentication

All endpoints require a **Keycloak JWT** with the appropriate realm role (`night_auditor` or `admin` for night audit; `admin`, `night_auditor`, or `revenue_manager` for group cutoffs).

Two supported options:

### Option A — Client credentials (recommended)

1. In Keycloak, create a **confidential** client (e.g. `haip-cron`) with **Service accounts** enabled.
2. Assign realm roles to the service account user: at minimum `night_auditor` (or `admin`).
3. Copy the client secret from the **Credentials** tab.
4. Export:

```bash
export HAIP_URL=https://pms.example.com
export HAIP_PROPERTY_ID=<property-uuid>
export KEYCLOAK_URL=https://auth.example.com
export KEYCLOAK_REALM=haip
export KEYCLOAK_CLIENT_ID=haip-cron
export KEYCLOAK_CLIENT_SECRET=<secret>
```

Scripts fetch a short-lived token automatically before each run.

### Option B — Pre-issued token

If you refresh tokens externally, set `HAIP_CRON_TOKEN` to a valid Bearer JWT and omit Keycloak client vars.

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `HAIP_URL` | yes | Base URL of your deployment (no trailing slash) |
| `HAIP_PROPERTY_ID` | yes | Property UUID to operate on |
| `HAIP_BUSINESS_DATE` | no | Night audit date (`YYYY-MM-DD`); defaults to yesterday UTC |
| `HAIP_CRON_TOKEN` | option B | Pre-fetched JWT |
| `KEYCLOAK_URL` | option A | Keycloak base URL |
| `KEYCLOAK_REALM` | option A | Realm name (default `haip`) |
| `KEYCLOAK_CLIENT_ID` | option A | Cron service client id |
| `KEYCLOAK_CLIENT_SECRET` | option A | Cron service client secret |

## Install

```bash
chmod +x scripts/cron/*.sh
```

Copy [`crontab.example`](./crontab.example), edit paths and env, then:

```bash
crontab scripts/cron/crontab.example
```

Or source env from a file:

```bash
# /etc/haip/cron.env  (mode 600, root-owned)
set -a
source /etc/haip/cron.env
set +a
/path/to/haip/scripts/cron/night-audit.sh
```

## Scripts

| Script | Schedule (typical) | API |
|--------|-------------------|-----|
| `night-audit.sh` | Daily ~00:30 property local time | `POST /api/v1/night-audit/run` |
| `group-cutoffs.sh` | Daily after night audit | `POST /api/v1/groups/blocks/process-cutoffs` |

Scripts exit non-zero on HTTP errors (non-2xx).
