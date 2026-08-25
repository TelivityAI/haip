# Booking Request Stay Amendments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development to execute every behavior as a red-green-refactor cycle. This Task 12 plan is executed inline because delegation is explicitly prohibited.

**Goal:** Let staff safely amend dates and the operational price of the reservation linked to an accepted Booking Request without mutating the original request deal or duplicating folio revenue.

**Architecture:** A property-scoped amendment record is the durable idempotency boundary and owns the preview fingerprint, old/new operational state, and stable webhook identity. Booking Request orchestration locks property, request, reservation, and room-type inventory in that order, delegates the guarded reservation update through an amendment-only seam, and reconciles only accepted-pricing folio groups while leaving payments and unrelated extras untouched. Pure pricing helpers derive prior-basis snapshots from the immutable operational snapshot and normalize current/custom snapshots from the authoritative quote.

**Tech Stack:** TypeScript strict mode, NestJS, Drizzle ORM, PostgreSQL, Decimal.js, React, TanStack Query, Vitest, Testing Library, Tailwind CSS.

**Spec:** `docs/superpowers/specs/2026-08-24-booking-requests-design.md` and `.superpowers/sdd/2026-08-24-booking-requests/task-12-brief.md`

## Global Constraints

- Only an accepted request with a same-property linked reservation and folio can be amended.
- Request submission, quote, acceptance, and accepted-price columns remain immutable.
- Dates are canonical `YYYY-MM-DD`, checkout is after check-in, and every amended night must remain available after excluding the current reservation.
- The commit path locks property, request, reservation, and inventory in that order and recomputes the authoritative quote under those locks.
- Prior-basis extensions copy the nearest boundary night's immutable room/tax basis; overlapping nights remain byte-for-byte priced; per-night services use the same nearest-boundary rule; one-time services and the existing explicit adjustment remain fixed.
- Removed posted accepted-pricing groups are reversed when unlocked and offset by a linked amendment adjustment when locked; changed posted overlap receives one linked adjustment; future groups retain stable night-audit source keys.
- Custom totals are positive, use the request/reservation currency's exact minor-unit precision, and require a reason.
- Amendment retries are property-scoped and fingerprinted; one amendment produces one audit entry and one durable `reservation.modified` consequence, with no email.
- The dashboard has no guest-facing route, disables duplicate submission, exposes server conflicts, and invalidates request, reservation, availability, folio, payment, and audit query families.

---

### Task 1: Durable amendment contract and pricing derivation

**Files:**
- Modify: `packages/database/src/schema/booking-request.ts`
- Modify: `packages/database/src/schema/reservation.ts`
- Modify: `packages/database/src/schema/index.ts`
- Modify: `packages/database/src/booking-request-schema.spec.ts`
- Create: `packages/database/src/migrations/0029_booking_request_stay_amendments.sql`
- Modify: `packages/database/src/push-schema.ts`
- Create: `apps/api/src/modules/booking-request/booking-request-amendment-pricing.ts`
- Create: `apps/api/src/modules/booking-request/booking-request-amendment-pricing.spec.ts`

**Interfaces:**
- Produces `bookingRequestStayAmendments` with property/request/reservation scope, idempotency key, operation fingerprint, preview token, pricing source, immutable old/new state, actor/reason, and stable completion data.
- Produces `buildPriorAmendedPricingSnapshot(previous, arrivalDate, departureDate)` and `buildAmendedPricingSnapshot(source, previous, currentQuote, currency, customTotal, customReason)`.

- [ ] Write schema and pure-pricing tests that fail because the amendment table and helpers do not exist.
- [ ] Run the database and pricing specs and verify the missing exports/functions are the failure.
- [ ] Add the minimum schema, migration/push-schema DDL, and deterministic snapshot derivation.
- [ ] Re-run the focused specs and refactor only while green.

### Task 2: Guarded reservation amendment seam and stable night posting

**Files:**
- Modify: `apps/api/src/modules/reservation/dto/modify-reservation.dto.ts`
- Modify: `apps/api/src/modules/reservation/reservation.service.ts`
- Modify: `apps/api/src/modules/reservation/reservation.controller.ts`
- Modify: `apps/api/src/modules/reservation/reservation-ops.spec.ts`
- Modify: `apps/api/src/modules/night-audit/night-audit.service.ts`
- Modify: `apps/api/src/modules/night-audit/night-audit.service.spec.ts`

**Interfaces:**
- Produces `ReservationAmendmentResult` containing the updated row plus previous dates and totals.
- Produces an explicit accepted-stay amendment seam requiring a locked reservation, new pricing snapshot, and caller transaction; generic modification still rejects accepted pricing changes.
- Night audit claims `accepted-pricing:reservation:<reservationId>:night:<date>` before posting room/tax/adjustment groups.

- [ ] Write failing tests for canonical dates, audit-ready return values, generic guard retention, explicit seam behavior, and replay-safe room posting.
- [ ] Run focused reservation/night-audit tests and verify the expected failures.
- [ ] Implement the minimum seam, controller response unwrapping, and source-key use.
- [ ] Re-run focused tests and refactor only while green.

### Task 3: Transactional amendment orchestration and folio reconciliation

**Files:**
- Create: `apps/api/src/modules/booking-request/dto/amend-booking-request-stay.dto.ts`
- Create: `apps/api/src/modules/booking-request/booking-request-amendment.spec.ts`
- Modify: `apps/api/src/modules/booking-request/booking-request.service.ts`
- Modify: `apps/api/src/modules/booking-request/booking-request.controller.ts`
- Modify: `apps/api/src/modules/booking-request/dto/booking-request-response.dto.ts`

**Interfaces:**
- Produces `BookingRequestService.stayAmendmentPreview(requestId, propertyId, dates)`.
- Produces `BookingRequestService.amendStay(requestId, propertyId, input, actor)`.
- Produces detail `operationalReservation` with current dates, total, and currency while all request deal fields remain original.

- [ ] Write failing service/controller tests for accepted-only/property scope, full-window availability, lock order, extension/shortening, price choices, currency/custom validation, preview races, folio reversal/adjustment/extras preservation, idempotent retry/concurrency, immutable request fields, audit, balance, and outbox.
- [ ] Run the focused API spec and verify failure because preview/amend orchestration is absent.
- [ ] Implement preview fingerprinting, ordered locking, quote recomputation, idempotency replay, folio reconciliation, reservation delegation, audit, and durable outbox in one transaction.
- [ ] Re-run the API spec and adjacent reservation/night-audit/folio tests, then refactor only while green.

### Task 4: Accessible dashboard Modify Stay workflow

**Files:**
- Create: `apps/dashboard/src/components/booking-requests/ModifyStayModal.tsx`
- Create: `apps/dashboard/src/components/booking-requests/ModifyStayModal.test.tsx`
- Modify: `apps/dashboard/src/components/booking-requests/RequestOverview.tsx`
- Modify: `apps/dashboard/src/components/booking-requests/RequestPayments.tsx`
- Modify: `apps/dashboard/src/components/booking-requests/queryKeys.ts`
- Modify: `apps/dashboard/src/components/booking-requests/types.ts`
- Modify: `apps/dashboard/src/pages/BookingRequests.tsx`
- Modify: `apps/dashboard/src/locales/*.json`

**Interfaces:**
- Produces an accepted-only staff action with old/new stay date rail, prior/current/custom price cards, custom reason validation, conflict refresh, and duplicate-submit protection.

- [ ] Write the failing modal test for current operational dates, authoritative preview, all price choices, exact money validation, duplicate disabling, server conflict retention, and complete query invalidation.
- [ ] Run the focused dashboard test and verify the missing component/behavior failure.
- [ ] Implement the existing Telivity visual language with one subject-specific signature: a quiet old-to-new stay rail connecting the two date windows; preserve existing typography and navy/teal/orange semantic tokens.
- [ ] Re-run the modal and Booking Requests page tests, inspect accessibility behavior, and remove any decorative element that does not clarify the operational change.

### Task 5: Verification, report, and commit

**Files:**
- Create: `.superpowers/sdd/2026-08-24-booking-requests/task-12-report.md`

- [ ] Run database schema and live PostgreSQL migration checks.
- [ ] Run full API and dashboard tests, then repository typecheck, lint, build, and locale JSON validation.
- [ ] Run React Doctor with `--verbose --diff`, fix Task 12 errors, and re-run it.
- [ ] Review the complete diff against the Task 12 brief and product contract; document exact evidence and any pre-existing warnings.
- [ ] Commit only Task 12 files with `feat(booking-requests): amend accepted stays`; do not push or create a PR.
