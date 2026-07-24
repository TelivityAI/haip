# BI tools on read-only Postgres (Metabase, Grafana, Superset, Redash)

Self-hosted HAIP stores operational data in **PostgreSQL**. Many teams attach a BI tool for dashboards without going through the REST API.

This recipe describes a **standard DBA pattern**. It does not embed connection strings or production secrets — configure those in your deployment secrets store.

## Principles

1. **Read-only** — BI queries must not write to the PMS database.
2. **Separate login** — dedicated database role for analytics, not the application `DATABASE_URL` user.
3. **Least privilege** — grant `SELECT` only on schemas/tables the tool needs.
4. **Multi-tenancy** — HAIP rows are scoped by `property_id` on tenant tables; filter or expose views per property in BI row-level security where supported.

## Example role (adjust names)

Run as a superuser or migration admin on your HAIP Postgres instance:

```sql
CREATE ROLE haip_bi LOGIN PASSWORD 'choose-a-strong-password';
GRANT CONNECT ON DATABASE haip TO haip_bi;
GRANT USAGE ON SCHEMA public TO haip_bi;

-- Grant SELECT on reporting-safe tables only (expand deliberately)
GRANT SELECT ON ALL TABLES IN SCHEMA public TO haip_bi;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON TABLES TO haip_bi;

-- Optional: property-scoped view for a single hotel
CREATE VIEW bi_reservations_property_a AS
  SELECT * FROM reservations
  WHERE property_id = '00000000-0000-4000-8000-000000000001';

GRANT SELECT ON bi_reservations_property_a TO haip_bi;
```

Revoke access to tables that hold secrets (API key hashes, channel credentials) if your schema includes them — prefer views that omit sensitive columns.

## Tool connection

| Tool | Typical setup |
|------|----------------|
| **Metabase** | Admin → Databases → PostgreSQL, read-only user, SSL if remote |
| **Grafana** | PostgreSQL data source, macro-friendly time columns on `created_at` / business dates |
| **Apache Superset** | Database connection + dataset per view; use SQL Lab for guarded queries |
| **Looker Studio** | Community Postgres connector or scheduled CSV from accounting/reports exports |
| **Redash** | Data source → PostgreSQL, query snippets saved per dashboard |

Point all tools at a **replica** when available so heavy reporting does not contend with the API primary.

## Query hygiene

- Prefer aggregated queries (occupancy, revenue by date) over wide joins on guest PII unless your privacy policy allows it.
- Align business dates with HAIP night audit / property timezone settings used in reports.
- Do not use BI write-back against production — operational changes go through the API.

## When to use the API instead

Use **[Webhooks](../webhooks.md)** or REST exports ([accounting CSV](accounting-csv.md)) when you need curated, audited extracts rather than raw table access.
