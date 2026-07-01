# Scheduled operations (external cron)

HAIP does not run in-process cron jobs. Use an external scheduler (system cron, Kubernetes CronJob, GitHub Actions, etc.) to call these authenticated API endpoints on a schedule.

All requests require a valid Keycloak JWT with the appropriate role unless noted.

Base URL: `https://<your-host>/api/v1`

## Night audit

Run once per property per business date (typically after midnight local time).

```
POST /night-audit/run
Authorization: Bearer <token>
Content-Type: application/json

{ "propertyId": "<uuid>", "businessDate": "2026-07-01" }
```

Role: `admin` or `night_auditor`

## AI agent training

Train all enabled agents on property history (recommended nightly).

```
POST /agents/<propertyId>/train-all
Authorization: Bearer <token>
```

Role: `admin`

## Group block cutoffs (auto-release sweep)

Release all blocks past their cutoff date for a property. Run daily (typically after night audit).

```
POST /groups/blocks/process-cutoffs?propertyId=<uuid>
Authorization: Bearer <token>
```

Role: `admin`, `night_auditor`, or `revenue_manager`

## Group allotment release (single block)

Release unsold group inventory for one block (call from night audit workflow or on demand).

```
POST /groups/blocks/<blockId>/release?propertyId=<uuid>
Authorization: Bearer <token>
```

Role: `admin`, `front_desk`, or `revenue_manager`

## Channel ARI push (optional)

Push availability/rates to connected OTAs (daily or on-demand).

```
POST /channels/push/full
Authorization: Bearer <token>
Content-Type: application/json

{
  "propertyId": "<uuid>",
  "channelConnectionId": "<uuid>",
  "startDate": "2026-07-01",
  "endDate": "2026-07-31"
}
```

Role: `admin`

## Health check (unauthenticated)

```
GET /health
```

Use for load balancer / uptime monitoring.
