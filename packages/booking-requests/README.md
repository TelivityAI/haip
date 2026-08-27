# @telivityhaip/booking-requests

Optional request-first direct booking for HAIP (STR / coliving workflows).

## Enable

1. Run core migrations: `pnpm db:migrate`
2. Run booking-requests migrations: `pnpm db:migrate:booking-requests`
3. Set `HAIP_BOOKING_REQUESTS=true` in `apps/api/.env` (and `VITE_HAIP_BOOKING_REQUESTS=true`
   at Docker build time for the dashboard/booking UIs — see `apps/api/Dockerfile`)
4. Set property `bookingMode=request` in booking engine admin settings

When disabled (default), core HAIP instant booking is unchanged, and none of this
package's tables/migrations are touched.

## Migrations

`src/database/migrate.ts` (compiled to `dist/database/migrate.js`) applies pending
`src/database/migrations/*.sql` files once each, tracked in their own
`booking_requests_schema_migrations` ledger table (separate from core's
`schema_migrations` — this package's migrations restart numbering from 0022 and
would otherwise collide with core's own version 0022). Use `db:migrate` in
production (runs the compiled `dist/` entry — the Docker image ships only `dist/`
and `package.json`, no `src/`/tsx) or `db:migrate:dev` locally against `src/`.

## Remaining work (not done in this pass)

- **Vertical-slice move**: `apps/api/src/modules/booking-request/**` (controllers,
  services, DTOs, dashboard/booking-widget UI) still lives in the main API app and
  is wired in conditionally via `apps/api/src/booking-requests.bootstrap.ts`. Moving
  that whole slice into this package is a larger, separate change.
- **Core push-schema de-pollution**: `packages/database/src/push-schema.ts` still
  carries a handful of request-related columns needed by core regardless of the
  flag (`payments.booking_request_id`, `payments.idempotency_key`,
  `reservations.accepted_pricing_snapshot`, `charges.source_key`,
  `charges.adjusts_charge_id`, `audit_logs.booking_request_id`). These were left in
  place because core code paths (and/or other features) reference them even with
  this package disabled; removing them needs a case-by-case audit, not a bulk pass.

## Credit

Original implementation by [@agustinjch](https://github.com/agustinjch).
