# Task 12 Ledger and Pricing-Lock Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Make accepted-stay amendment repricing, room/service posting, cancellation, closed-day accounting, and retries serialize on one reservation mutex and converge to an additive, reportable ledger.

**Architecture:** Add one transaction-scoped PostgreSQL advisory-lock module keyed by property and reservation, and make amendment, accepted room posting, accepted ancillary posting, and service cancellation acquire it before re-reading mutable state. Represent amendment deltas as non-reversal category-preserving ledger rows with explicit `adjusts_charge_id` provenance; use canonical source keys for immutable groups and current-open-business-date recovery for closed dates.

**Tech Stack:** NestJS, TypeScript, Drizzle ORM, PostgreSQL 16, Vitest, decimal.js, pnpm monorepo.

**Spec:** `.superpowers/sdd/2026-08-24-booking-requests/task-12-brief.md` plus the blocking Task 12 review dated 2026-08-25.

## Global Constraints

- Preserve immutable Booking Request evidence and generic reservation/folio behavior.
- Use one property+reservation lock order and perform no webhook or other external I/O while it is held.
- `is_reversal` is reserved for exact reversals created by the canonical reversal flow.
- Never mutate or backdate into a completed audit day; amendment deltas for closed groups post on the current open business date.
- Execute inline without subagents, Task 13, push, or pull request.

---

### Task 1: Shared accepted-pricing transaction mutex

**Files:**
- Create: `apps/api/src/common/database/accepted-pricing-lock.ts`
- Test: `apps/api/src/common/database/accepted-pricing-lock.spec.ts`
- Modify: `apps/api/src/modules/booking-request/booking-request.service.ts`

**Interfaces:**
- Produces: `withAcceptedPricingLock(db, propertyId, reservationId, work, tx?)`, which starts or reuses one transaction, obtains `pg_advisory_xact_lock(hashtextextended(...))`, then invokes `work(tx)`.
- Consumes: Drizzle transaction adapters exposing `execute` and root adapters exposing `transaction`.

- [x] Write a failing adapter test proving the callback runs after the advisory lock and an existing transaction is reused.
- [x] Run `pnpm --filter api test -- --run src/common/database/accepted-pricing-lock.spec.ts` and verify RED.
- [x] Implement the lock module and make `amendStay` acquire it after the property/request lock but before reading the linked reservation and authoritative quote.
- [x] Run the lock and booking-amendment specs and verify GREEN.

### Task 2: Posting re-read and external-I/O boundary

**Files:**
- Modify: `apps/api/src/modules/folio/folio.service.ts`
- Modify: `apps/api/src/modules/night-audit/night-audit.service.ts`
- Modify: `apps/api/src/modules/ancillary/ancillary.service.ts`
- Test: `apps/api/src/modules/night-audit/night-audit.service.spec.ts`
- Test: `apps/api/src/modules/ancillary/ancillary-accepted-pricing.spec.ts`

**Interfaces:**
- Consumes: `withAcceptedPricingLock(...)` and `postChargeFromSnapshotWithOutcome(..., tx)`.
- Produces: public room/once/per-night posting behavior that re-reads reservation and reservation-service state after the lock and returns event payloads for dispatch after commit.

- [x] Add failing room and ancillary tests in which the pre-lock candidate is stale but the locked re-read contains an amended/removed/cancelled snapshot.
- [x] Run the two focused specs and verify RED.
- [x] Let FolioService reuse a caller transaction; refactor accepted room and ancillary paths to lock, re-read, post, and update state atomically, then emit webhooks only after commit.
- [x] Run the focused specs and verify GREEN.

### Task 3: Additive amendment-adjustment ledger and once-date revisions

**Files:**
- Modify: `packages/database/src/schema/folio.ts`
- Create: `packages/database/src/migrations/0030_booking_request_amendment_adjustments.sql`
- Modify: `packages/database/src/push-schema.ts`
- Modify: `packages/database/src/booking-request-migration-safety.spec.ts`
- Modify: `packages/database/src/booking-request-schema.spec.ts`
- Modify: `apps/api/src/modules/folio/folio.service.ts`
- Test: `apps/api/src/modules/folio/folio-stay-amendment.spec.ts`

**Interfaces:**
- Produces: nullable `charges.adjustsChargeId`, date-bearing once keys `accepted-pricing:reservation-service:<rowId>:once:<YYYY-MM-DD>`, and non-reversal component adjustments with stable amendment keys.
- Consumes: immutable canonical base/tax/custom groups and the latest completed/locked audit boundary.

- [x] Add failing schema/migration and FolioService tests for 100→80, tax-only decrease, 100→120→removed, 100→80→100→70, locked rows, closed missing groups, once re-date, and replay.
- [x] Run focused database and folio specs and verify RED.
- [x] Add the self-FK column/backfill, compute additive component totals, write every amendment delta as `isReversal=false` with category/type and `adjustsChargeId`, and post locked/closed corrections or recoveries on the next open business date.
- [x] Run focused database, folio, report, and night-audit specs and verify GREEN.

### Task 4: Cancellation-authoritative operational snapshots

**Files:**
- Modify: `apps/api/src/modules/booking-request/booking-request-amendment-pricing.ts`
- Modify: `apps/api/src/modules/booking-request/booking-request.service.ts`
- Modify: `apps/api/src/modules/ancillary/ancillary.service.ts`
- Modify: `apps/api/src/modules/ancillary/ancillary.controller.ts`
- Test: `apps/api/src/modules/booking-request/booking-request-amendment.spec.ts`
- Test: `apps/api/src/modules/ancillary/ancillary-accepted-pricing.spec.ts`

**Interfaces:**
- Produces: an amendment pricing basis filtered to active reservation services, plus mutex-protected service cancellation scoped to its route reservation.
- Consumes: locked reservation-service rows and their `confirmed`, `posted`, or `cancelled` state.

- [x] Add failing preview/commit, once, per-night, and cancellation-race tests proving cancelled services never enter the new total or ledger.
- [x] Run focused booking/ancillary specs and verify RED.
- [x] Filter cancelled services before prior/current/custom pricing, include that basis in the preview fingerprint, skip cancelled rows before any post, and make post-state failure roll back instead of leaving a charge.
- [x] Run focused booking/ancillary specs and verify GREEN.

### Task 5: PostgreSQL races, reports, and release verification

**Files:**
- Create or modify: `apps/api/src/modules/booking-request/booking-request-amendment.db.spec.ts`
- Modify: `.superpowers/sdd/2026-08-24-booking-requests/task-12-report.md`

**Interfaces:**
- Tests public amendment/posting seams against PostgreSQL and public reporting/night-audit totals.

- [x] Add opt-in live PostgreSQL races that pause an old-snapshot poster, commit an amendment/cancellation under the shared mutex, and assert only the locked re-read outcome can claim a source key without deadlock.
- [x] Run migration/push fresh and replay, seed, migration 0030 replay, and the live race contract on PostgreSQL 16.
- [x] Run all affected specs, `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`, React Doctor, and `git diff --check`.
- [x] Update the Task 12 report with the mutex, additive ledger, closed-day, once-revision, cancellation, PostgreSQL, and verification evidence.
- [x] Commit as `fix(booking-requests): serialize accepted pricing ledger` and confirm a clean worktree.
