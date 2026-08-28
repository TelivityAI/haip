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

## Package boundary

The full Nest vertical slice — controllers (`src/http/`), DTOs (`src/http/dto/`),
services, the Stripe webhook handler, pricing/money/state/ledger/reconciler/template
helpers, and their unit specs (`src/domain/`) — lives in this package, not
`apps/api`. `BookingRequestModule.forRoot(...)` (`src/module/booking-request.module.ts`)
is a real NestJS `DynamicModule` that owns those controllers and providers directly;
it is not a facade re-exporting `apps/api` classes. The package never imports from
`apps/api` — it depends only on `@telivityhaip/database`, `@telivityhaip/shared`,
and a set of package-local DI ports (`src/module/ports.ts`: folio, webhook, email,
reservation, rate-plan, guest, ancillary, availability, booking-engine, and
booking-engine-config, plus guard-bridge ports for the public controller's
credential/scope/throttle checks).

`apps/api/src/booking-requests.bootstrap.ts` is the only place core wires itself to
this package: it binds every port to the concrete core singleton that satisfies it
(mostly `{ useExisting: CoreService }`) inside `BookingRequestModule.forRoot(...)`,
and only does so when `HAIP_BOOKING_REQUESTS=true`. `apps/api` itself keeps only:

- The bootstrap wiring above, plus the guard classes it already owned
  (`BookingKeyGuard`, `BookingEngineScopeGuard`, `BookingThrottleGuard`) — these are
  shared with core's own `BookingEngineController` and stay the single source of
  truth for credential/scope/rate-limit checks.
- The regression/integration specs that exercise the flag end-to-end from
  `apps/api`'s Nest app (`apps/api/src/modules/booking-request/*.e2e-spec.ts`,
  `*-authorization.spec.ts`, `*-default-flow-regression.spec.ts`,
  `*-flag-off-instant-booking.regression.spec.ts`, `regression-database-utils.ts`).
- Thin schema/config hooks core reads directly regardless of the flag:
  `booking_engine_config.booking_mode` / `payment_method_collection` /
  `form_questions` (the request-mode fail-safe gate in
  `BookingEngineConfigService.updateConfig`), and `payments.booking_request_id` /
  `idempotency_key`, `reservations.accepted_pricing_snapshot`, and
  `charges.adjusts_charge_id` / `source_key` (financial-target and reversal
  provenance invariants). See `packages/database/src/push-schema-kept-fields.spec.ts`
  for the exact contract of what core keeps vs. what only this package's own
  migrations declare (`audit_logs.booking_request_id` + its timeline index, and the
  request-shape unique indexes/checks on `payments`).

## Credit

Original implementation by [@agustinjch](https://github.com/agustinjch).
