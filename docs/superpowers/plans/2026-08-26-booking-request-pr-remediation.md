# Booking Request PR Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make PR #347 mergeable by preserving the instant-booking financial contract, making request-mode policies fail closed, closing the remaining approved-spec gaps, restoring complete auditing, and removing every PR-added raw database query from runtime code.

**Architecture:** The shared Stripe webhook remains one ingress but explicitly separates HAIP-owned request events, HAIP-owned legacy/instant events, malformed HAIP events, and unrelated Stripe-account traffic. Request-only behavior stays inside the Booking Request module; shared folio, payment, reservation, and night-audit paths retain their pre-PR contracts. Runtime persistence uses Drizzle query-builder primitives and row locks; raw SQL remains confined to migration/schema-bootstrap files.

**Tech Stack:** TypeScript strict mode, NestJS, Drizzle ORM, PostgreSQL, Stripe SDK, React, Vitest, Testing Library, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-08-24-booking-requests-design.md`

## Global Constraints

- Instant booking is the default and must behave exactly as it did at merge-base `552ac622`, including Stripe-dashboard full and partial refunds.
- Unrelated traffic on a shared Stripe account must receive `200` and must not create, update, audit, or emit HAIP financial events.
- An event carrying HAIP correlation metadata is owned; malformed or contradictory owned metadata must fail so Stripe retries it.
- Request-mode `required` card collection must never be rewritten to `disabled`; unavailable required collection blocks setup and submission with an explicit error.
- Every property-scoped query filters by caller- or signed-metadata-supplied `propertyId` together with entity ID.
- No raw card data is stored.
- Every data modification added or changed by this remediation is audited in the same transaction.
- Runtime services use Drizzle query-builder functions only. Raw SQL is allowed only in `packages/database/src/migrations/*.sql` and the repository's migration-equivalent `packages/database/src/push-schema.ts`.
- Drizzle schema `check(...)` expressions are schema declarations, not runtime queries, and remain allowed.
- Do not broaden currency support by silently rounding. The current `numeric(12,2)` ledger supports currency exponents 0, 1, and 2 only.
- Each task is a reviewable commit and leaves its focused test suite green.

## File and responsibility map

- `apps/api/src/modules/payment/stripe-webhook.controller.ts`: classify Stripe ownership; route legacy and request payment/refund events without cross-contamination.
- `apps/api/src/modules/payment/stripe-financial-state.ts`: pure correlation/ownership and monotonic transition decisions.
- `apps/api/src/modules/payment/stripe-webhook.spec.ts`: legacy refund, request refund, replay, ownership, and poison-webhook contracts.
- `apps/api/src/modules/folio/folio.service.ts`: unchanged folio sum invariant, exercised by refund integration tests.
- `apps/api/src/modules/booking-engine/booking-engine-config.service.ts`: preserve configured card policy, validate runtime capability, and audit changes.
- `apps/api/src/modules/booking-engine/booking-engine-admin.controller.ts`: pass authenticated audit actor to configuration writes.
- `apps/api/src/modules/booking-request/booking-request.service.ts`: submission policy, denormalized submitted total, raw-free list and audit pagination.
- `apps/api/src/modules/booking-request/booking-request-payment.service.ts`: partial-installment edits/removal and raw-free reorder.
- `apps/api/src/common/database/accepted-pricing-lock.ts`: replace advisory SQL with a property-scoped reservation row lock.
- `apps/api/src/modules/night-audit/night-audit.service.ts`: use Drizzle predicates for accepted-pricing status filtering.
- `apps/api/src/modules/reports/reports.service.ts`: use Drizzle aggregate functions for the changed reversal calculation.
- `packages/database/src/schema/booking-request.ts`: add `submittedTotal` as a first-class sortable amount.
- `packages/database/src/schema/audit.ts`: add a durable monotonic audit timeline sequence.
- `packages/database/src/migrations/0032_booking_request_remediation.sql`: backfill the two query-support columns and indexes; SQL is permitted here.
- `packages/database/src/push-schema.ts`: mirror migration-equivalent DDL for the repository's existing bootstrap path.

---

### Task 1: Restore Stripe-dashboard refunds for instant bookings

**Files:**
- Modify: `apps/api/src/modules/payment/stripe-webhook.controller.ts`
- Modify: `apps/api/src/modules/payment/stripe-webhook.spec.ts`
- Test: `apps/api/src/modules/payment/stripe-webhook.spec.ts`

**Interfaces:**
- Produces: cumulative legacy-refund reconciliation for a payment where `bookingRequestId === null`.
- Preserves: exact claim-correlated `refund.*` handling for request payments.
- Preserves: `FolioService.recalculateBalance(folioId, propertyId, tx)` after the negative movement is durable.

- [ ] **Step 1: Replace the regression test with failing legacy refund contracts**

Add tests that create a captured legacy payment of `100.00` and assert:

```ts
it('posts the missing negative movement for a partial instant-booking refund', async () => {
  const legacy = payment({ bookingRequestId: null, folioId: FOLIO_ID, amount: '100.00' });
  const h = await harness({ requests: [], payments: [legacy] });

  await h.controller.handleChargeRefunded({
    id: 'ch_legacy', payment_intent: 'pi_request_1', amount_refunded: 2500,
    currency: 'usd', refunds: { data: [] },
  });

  expect(h.state.payments).toContainEqual(expect.objectContaining({
    propertyId: PROPERTY_ID,
    folioId: FOLIO_ID,
    originalPaymentId: PAYMENT_ID,
    amount: '-25.00',
    status: 'captured',
  }));
  expect(h.folioService.recalculateBalance)
    .toHaveBeenCalledWith(FOLIO_ID, PROPERTY_ID, h.db);
});
```

Add separate cases for a full refund, delivery of cumulative `25` twice, cumulative `25` followed by `50`, and out-of-order cumulative `50` followed by `25`. Assert one child for replay, two children of `-25.00` for progression, and no over-refund.

- [ ] **Step 2: Run the focused test and verify the regression is exposed**

Run: `pnpm --filter @telivityhaip/api test -- src/modules/payment/stripe-webhook.spec.ts`

Expected: FAIL because `handleChargeRefunded` currently leaves the legacy payment ledger unchanged.

- [ ] **Step 3: Restore cumulative reconciliation under the parent-payment row lock**

In `handleChargeRefunded`, keep the current request-payment branch. For a legacy parent:

```ts
const children = await tx
  .select()
  .from(payments)
  .where(and(
    eq(payments.propertyId, parent.propertyId),
    eq(payments.originalPaymentId, parent.id),
    eq(payments.status, 'captured'),
  ));
const cumulative = this.fromStripeMinorUnits(charge.amount_refunded, charge.currency);
const alreadyPosted = children.reduce(
  (total, child) => total.plus(new Decimal(child.amount).abs()),
  new Decimal(0),
);
const delta = cumulative.minus(alreadyPosted);
```

Validate currency identity, ignore `delta <= 0` as replay/out-of-order delivery, reject cumulative refund above the captured parent amount, and insert one captured negative child for positive `delta`. Link `propertyId`, `folioId`, `originalPaymentId`, `gatewayProvider: 'stripe'`, and a cumulative idempotency key derived from charge ID and `amount_refunded`.

- [ ] **Step 4: Recalculate and emit only after durable insertion**

Recalculate inside the transaction after insertion. Return an outcome from the transaction and emit `payment.refunded` after commit using the negative movement ID. A replay returns no emission.

- [ ] **Step 5: Run refund and folio tests**

Run: `pnpm --filter @telivityhaip/api test -- src/modules/payment/stripe-webhook.spec.ts src/modules/folio/folio.service.spec.ts`

Expected: PASS; cumulative legacy refunds change the folio once and request refunds still use exact claims.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/payment/stripe-webhook.controller.ts apps/api/src/modules/payment/stripe-webhook.spec.ts
git commit -m "fix(payments): restore instant Stripe refund reconciliation"
```

---

### Task 2: Stop unrelated Stripe events from poisoning the webhook endpoint

**Files:**
- Modify: `apps/api/src/modules/payment/stripe-financial-state.ts`
- Modify: `apps/api/src/modules/payment/stripe-financial-state.spec.ts`
- Modify: `apps/api/src/modules/payment/stripe-webhook.controller.ts`
- Modify: `apps/api/src/modules/payment/stripe-webhook.spec.ts`

**Interfaces:**
- Produces: `classifyHaipMetadata(metadata): 'external' | 'owned-valid' | 'owned-malformed'` plus parsed correlation for valid ownership.
- Rule: no matching gateway transaction and no `haip_*` metadata means unrelated, acknowledged, and ignored.
- Rule: any `haip_*` marker makes the event owned; incomplete or contradictory correlation remains retryable.

- [ ] **Step 1: Write failing ownership tests**

Cover `payment_intent.succeeded`, `payment_intent.payment_failed`, and `refund.updated` with no HAIP metadata and no matching payment. Assert HTTP `200`, no DB writes, no audits, and no outbound webhook. Add malformed owned metadata such as `{ haip_payment_id: PAYMENT_ID }` and assert the handler rejects.

- [ ] **Step 2: Verify the unrelated-event tests fail**

Run: `pnpm --filter @telivityhaip/api test -- src/modules/payment/stripe-financial-state.spec.ts src/modules/payment/stripe-webhook.spec.ts`

Expected: FAIL because uncorrelated PaymentIntents and refunds currently throw `ConflictException`.

- [ ] **Step 3: Add a pure ownership classifier**

```ts
export function hasHaipFinancialMetadata(metadata: Stripe.Metadata): boolean {
  return Object.keys(metadata).some((key) => key.startsWith('haip_'));
}
```

Parse the complete correlation only after this check. Return `external` when there is neither a directly linked payment nor an HAIP marker. Keep existing strict parsers for owned events so malformed owned traffic still fails.

- [ ] **Step 4: Apply classification before transaction work**

In PaymentIntent and refund handlers, return without side effects for `external`. Do not log these as errors. Preserve errors for ambiguous gateway IDs, ownership mismatches, impossible state transitions requiring operator action, and malformed owned metadata.

- [ ] **Step 5: Run the focused webhook suite**

Run: `pnpm --filter @telivityhaip/api test -- src/modules/payment/stripe-financial-state.spec.ts src/modules/payment/stripe-webhook.spec.ts`

Expected: PASS; shared-account traffic is harmless while owned corrupt events still retry.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/payment/stripe-financial-state.ts apps/api/src/modules/payment/stripe-financial-state.spec.ts apps/api/src/modules/payment/stripe-webhook.controller.ts apps/api/src/modules/payment/stripe-webhook.spec.ts
git commit -m "fix(payments): ignore unrelated Stripe account events"
```

---

### Task 3: Make required card collection fail closed

**Files:**
- Modify: `apps/api/src/modules/booking-engine/booking-engine-config.service.ts`
- Modify: `apps/api/src/modules/booking-engine/booking-form-questions.spec.ts`
- Modify: `apps/api/src/modules/booking-request/booking-request.service.ts`
- Modify: `apps/api/src/modules/booking-request/booking-request-submission.spec.ts`
- Modify: `apps/booking/src/pages/RequestPayment.tsx`
- Modify: `apps/booking/src/pages/RequestPayment.test.tsx`

**Interfaces:**
- Public config returns the persisted `paymentMethodCollection` unchanged.
- `paymentMethodClientMode` describes capability; it never changes policy.
- Required + unavailable returns a blocking error and never submits without a card.

- [ ] **Step 1: Write failing server and widget tests**

Assert that a persisted `required` policy with an unsupported provider is returned as `required`, not `disabled`. Assert `createPaymentMethodSetup` and `submit` fail before quote or inserts. In the widget, assert the final submit action is unavailable and an explicit “card collection is unavailable” state is shown.

- [ ] **Step 2: Verify the fail-closed tests fail**

Run: `pnpm --filter @telivityhaip/api test -- src/modules/booking-engine/booking-form-questions.spec.ts src/modules/booking-request/booking-request-submission.spec.ts`

Run: `pnpm --filter @telivityhaip/booking test -- src/pages/RequestPayment.test.tsx`

Expected: at least the public-config assertion fails because it currently downgrades policy to `disabled`.

- [ ] **Step 3: Remove policy rewriting**

Return:

```ts
paymentMethodCollection: configuredPaymentMethodCollection,
paymentMethodClientMode,
```

Add one shared capability assertion used by setup and submission. It rejects unsupported providers and Stripe mode without a publishable key when the policy is `required` or when optional collection was selected.

- [ ] **Step 4: Render a blocking widget state**

When `paymentMethodCollection === 'required' && !cardCollectionAvailable`, render the setup error and do not navigate back to the application or invoke submission. Optional mode may still proceed without a card.

- [ ] **Step 5: Run focused and end-to-end request tests**

Run: `pnpm --filter @telivityhaip/api test -- src/modules/booking-engine/booking-form-questions.spec.ts src/modules/booking-request/booking-request-submission.spec.ts src/modules/booking-request/booking-request.e2e-spec.ts`

Run: `pnpm --filter @telivityhaip/booking test -- src/pages/RequestPayment.test.tsx src/pages/RequestFlow.e2e.test.tsx`

Expected: PASS with no request persisted under unavailable required collection.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/booking-engine apps/api/src/modules/booking-request apps/booking/src/pages
git commit -m "fix(booking-requests): enforce required card policy"
```

---

### Task 4: Implement edits and removal of only the unallocated installment portion

**Files:**
- Modify: `apps/api/src/modules/booking-request/booking-request-payment.service.ts`
- Modify: `apps/api/src/modules/booking-request/booking-request-payment.spec.ts`
- Modify: `apps/dashboard/src/components/booking-requests/RequestPayments.tsx`
- Modify: `apps/dashboard/src/components/booking-requests/PaymentActionModal.tsx`
- Test: `apps/api/src/modules/booking-request/booking-request-payment.spec.ts`

**Interfaces:**
- Editing a partially allocated installment is allowed when the resulting resolved amount is not below its durable allocation total.
- Deleting an unallocated installment deletes it.
- Removing a partially allocated installment trims its resolved amount to the allocated amount, converts it to fixed amount, and leaves the paid history intact.
- A fully allocated installment has no removable remainder and remains unchanged.

- [ ] **Step 1: Replace the blanket-rejection test with contract tests**

Add cases for metadata edit on a partially allocated installment, increasing its total, reducing its total to exactly the allocation, rejecting reduction below allocation, deleting an unallocated row, trimming a partial row, and rejecting removal of a fully allocated row.

```ts
await expect(service.updateInstallment(REQUEST_ID, INSTALLMENT_ID, PROPERTY_ID, {
  fixedAmount: '60.00',
}, actor)).resolves.toMatchObject({
  resolvedAmount: '60.00',
  allocatedAmount: '40.00',
  status: 'partial',
});
```

- [ ] **Step 2: Verify the new edit tests fail**

Run: `pnpm --filter @telivityhaip/api test -- src/modules/booking-request/booking-request-payment.spec.ts`

Expected: FAIL because any allocation currently blocks all edits except reorder and all deletion.

- [ ] **Step 3: Validate against the durable allocation sum**

After locking the request and installment, calculate the persisted allocation total. Normalize the proposed installment, reject only when `normalized.resolvedAmount < persistedAllocation`, and derive status from allocation versus the new total. Keep the allocated amount derived from allocation rows rather than trusting the cached column.

- [ ] **Step 4: Trim partial deletion instead of deleting history**

For allocation `A > 0` and resolved total `T > A`, update to fixed `A`, clear percentage, set resolved and allocated amount to `A`, and mark paid. Audit this as an update with description `Booking request unallocated installment remainder removed`. Delete only when `A === 0`.

- [ ] **Step 5: Align dashboard controls and copy**

Allow edit for partial installments. Label the partial delete action “Remove remaining amount,” show the amount that will remain, and keep fully paid installments non-removable.

- [ ] **Step 6: Run API and dashboard tests**

Run: `pnpm --filter @telivityhaip/api test -- src/modules/booking-request/booking-request-payment.spec.ts`

Run: `pnpm --filter @telivityhaip/dashboard test -- src/components/booking-requests`

Expected: PASS; no allocation row is deleted or rewritten by an installment edit.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/booking-request/booking-request-payment.service.ts apps/api/src/modules/booking-request/booking-request-payment.spec.ts apps/dashboard/src/components/booking-requests
git commit -m "fix(booking-requests): edit unallocated installment balances"
```

---

### Task 5: Reject unsupported currency precision at the request boundary

**Files:**
- Modify: `apps/api/src/modules/booking-request/booking-request-money.ts`
- Modify: `apps/api/src/modules/booking-request/booking-request-money.spec.ts`
- Modify: `apps/api/src/modules/booking-request/booking-request.service.ts`
- Modify: `apps/api/src/modules/booking-request/booking-request-submission.spec.ts`
- Modify: `apps/api/src/modules/booking-request/booking-request-decision.spec.ts`

**Interfaces:**
- Produces: `assertLedgerCurrencySupported(currencyCode): number` returning exponent 0–2.
- Submission fails before persistence when the authoritative quote currency requires more than two decimals.
- Acceptance, charges, and refunds reuse the same helper; no path rounds silently.

- [ ] **Step 1: Write failing boundary tests**

Use USD and JPY as supported examples and BHD as the unsupported scale-three example. Assert BHD submission creates no request and does not create a SetupIntent-derived ledger obligation.

- [ ] **Step 2: Run the money and submission tests**

Run: `pnpm --filter @telivityhaip/api test -- src/modules/booking-request/booking-request-money.spec.ts src/modules/booking-request/booking-request-submission.spec.ts src/modules/booking-request/booking-request-decision.spec.ts`

Expected: FAIL because scale-three rejection currently occurs late in payment/refund processing.

- [ ] **Step 3: Centralize and call the currency capability check**

```ts
export function assertLedgerCurrencySupported(currencyCode: string): number {
  const normalized = currencyCode.trim().toUpperCase();
  const exponent = new Intl.NumberFormat('en', {
    style: 'currency',
    currency: normalized,
  }).resolvedOptions().maximumFractionDigits;
  if (exponent > 2) {
    throw new BadRequestException(
      `${normalized} is not supported by the scale-two payment ledger`,
    );
  }
  return exponent;
}
```

Call it immediately after the authoritative quote is computed and before `resolveCard` or the submission transaction. Replace duplicated exponent checks in request pricing/payment paths with this helper.

- [ ] **Step 4: Run focused tests**

Run: `pnpm --filter @telivityhaip/api test -- src/modules/booking-request/booking-request-money.spec.ts src/modules/booking-request/booking-request-submission.spec.ts src/modules/booking-request/booking-request-payment.spec.ts src/modules/payment/stripe-webhook.spec.ts`

Expected: PASS; unsupported precision never becomes a poison webhook after an accepted request payment exists.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/booking-request apps/api/src/modules/payment/stripe-webhook.spec.ts
git commit -m "fix(booking-requests): validate ledger currency at submission"
```

---

### Task 6: Audit booking-engine configuration changes

**Files:**
- Modify: `apps/api/src/modules/booking-engine/booking-engine-admin.controller.ts`
- Modify: `apps/api/src/modules/booking-engine/booking-engine-config.service.ts`
- Modify: `apps/api/src/modules/booking-engine/booking-form-questions.spec.ts`

**Interfaces:**
- `updateConfig(propertyId, input, expectedVersion, actor)` records old and new values atomically.
- Audit payload includes request-mode, card policy, and form definitions but excludes raw publishable booking keys and any secret.

- [ ] **Step 1: Write a failing audit test**

Assert a successful request-setting update inserts one `auditLogs` row with the property, actor, `entityType: 'booking_engine_config'`, previous values, new values, and description. Assert stale `If-Match` and validation failures insert nothing.

- [ ] **Step 2: Verify the audit test fails**

Run: `pnpm --filter @telivityhaip/api test -- src/modules/booking-engine/booking-form-questions.spec.ts`

Expected: FAIL because config updates currently write no audit entry.

- [ ] **Step 3: Pass the authenticated actor and insert the audit in the transaction**

Use `@AuditActorCtx() actor: AuditActor` in the admin controller. After the successful update, insert:

```ts
await tx.insert(auditLogs).values({
  propertyId,
  action: 'update',
  entityType: 'booking_engine_config',
  entityId: updated.id,
  ...actorFields(actor),
  previousValue: sanitizeBookingEngineConfig(current),
  newValue: sanitizeBookingEngineConfig(updated),
  description: 'Booking engine configuration updated',
});
```

The sanitizer keeps operational settings and removes credential material.

- [ ] **Step 4: Run controller and service tests**

Run: `pnpm --filter @telivityhaip/api test -- src/modules/booking-engine/booking-form-questions.spec.ts`

Expected: PASS with audit and config update committed or rolled back together.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/booking-engine
git commit -m "fix(booking-engine): audit request configuration changes"
```

---

### Task 7: Remove PR-added raw SQL from runtime services

**Files:**
- Modify: `packages/database/src/schema/booking-request.ts`
- Modify: `packages/database/src/schema/audit.ts`
- Create: `packages/database/src/migrations/0032_booking_request_remediation.sql`
- Modify: `packages/database/src/push-schema.ts`
- Modify: `packages/database/src/booking-request-schema.spec.ts`
- Modify: `packages/database/src/booking-request-migration-safety.spec.ts`
- Modify: `apps/api/src/common/database/accepted-pricing-lock.ts`
- Modify: `apps/api/src/common/database/accepted-pricing-lock.spec.ts`
- Modify: `apps/api/src/common/database/accepted-pricing-lock.postgres.spec.ts`
- Create: `apps/api/src/booking-request-runtime-sql.spec.ts`
- Modify: `apps/api/src/modules/booking-request/booking-request.service.ts`
- Modify: `apps/api/src/modules/booking-request/booking-request-payment.service.ts`
- Modify: `apps/api/src/modules/booking-request/booking-request-payment.spec.ts`
- Modify: `apps/api/src/modules/night-audit/night-audit.service.ts`
- Modify: `apps/api/src/modules/night-audit/night-audit.service.spec.ts`
- Modify: `apps/api/src/modules/reports/reports.service.ts`
- Modify: `apps/api/src/modules/reports/reports.service.spec.ts`

**Interfaces:**
- Produces: `bookingRequests.submittedTotal` for sorting without JSON extraction SQL.
- Produces: `auditLogs.timelineSequence` for precise cursor pagination without epoch/cast SQL.
- Produces: property-scoped reservation row locking via `.for('update')`.
- Runtime files changed by PR #347 contain no `tx.execute(sql...)`, `sql.raw(...)`, or handwritten SQL predicates/expressions.

- [ ] **Step 1: Add failing schema and migration tests**

Assert both columns are exported, non-null after migration, and indexed for their query patterns. Migration `0032` backfills `submitted_total` from the immutable quote JSON and assigns `timeline_sequence` in `(occurred_at, id)` order before enforcing non-null/default behavior.

- [ ] **Step 2: Add failing raw-query inventory tests**

Add a source-level test over the PR-owned runtime files that rejects `execute(sql`, `sql.raw`, `pg_advisory`, JSON `->>`, handwritten ` case `, and handwritten ` in (`. Exclude migrations, `push-schema.ts`, and schema `check(...)` declarations.

- [ ] **Step 3: Add the query-support columns and migration**

Declare `submittedTotal: numeric('submitted_total', { precision: 12, scale: 2 }).notNull()` and a bigint timeline sequence. Update submission to write `submittedTotal: quote.grandTotal`. Mirror the permitted DDL in `push-schema.ts` because it is this repository's migration runner.

- [ ] **Step 4: Replace requested-total and count expressions**

Order by `bookingRequests.submittedTotal` and use Drizzle's `count()` aggregate:

```ts
const [countRow] = await this.db
  .select({ count: count() })
  .from(bookingRequests)
  .where(where);
```

- [ ] **Step 5: Replace audit microsecond SQL with sequence pagination**

Encode the opaque cursor as `{ timelineSequence: string }`, select the real column, filter with `lt(auditLogs.timelineSequence, cursor.timelineSequence)`, and order by `desc(auditLogs.timelineSequence)`. Because PR #347 is unmerged, no production request-audit cursor compatibility layer is required.

- [ ] **Step 6: Replace the advisory lock with a reservation row lock**

Inside the existing transaction:

```ts
const [locked] = await tx
  .select({ id: reservations.id })
  .from(reservations)
  .where(and(
    eq(reservations.id, reservationId),
    eq(reservations.propertyId, propertyId),
  ))
  .for('update');
if (!locked) throw new Error(`Reservation ${reservationId} not found for accepted-pricing lock`);
return work(tx);
```

Retain concurrency tests proving night audit and amendments serialize against the same reservation.

- [ ] **Step 7: Replace installment CASE SQL with locked Drizzle updates**

After validating the exact locked set, issue one Drizzle `.update(...).set({ sortOrder, updatedAt })` per installment in input order inside the same transaction. Do not use `Promise.all`; deterministic sequential statements retain lock ordering and rollback atomically.

- [ ] **Step 8: Replace added predicates and aggregate fragments**

Use `inArray(reservations.status, ['checked_in', 'stayover', 'due_out'])` in night audit. Use Drizzle `sum(charges.amount)` for the changed reversal query and negate the returned Decimal in TypeScript. Use `count()` wherever this PR introduced `sql<number>\`count(*)\``.

- [ ] **Step 9: Run database, concurrency, list, audit, night-audit, and report tests**

Run: `pnpm --filter @telivityhaip/database test`

Run: `pnpm --filter @telivityhaip/api test -- src/booking-request-runtime-sql.spec.ts src/common/database/accepted-pricing-lock.spec.ts src/common/database/accepted-pricing-lock.postgres.spec.ts src/modules/booking-request/booking-request-payment.spec.ts src/modules/booking-request/booking-request-pricing.spec.ts src/modules/night-audit/night-audit.service.spec.ts src/modules/ancillary/ancillary-accepted-pricing.spec.ts src/modules/reports/reports.service.spec.ts`

Expected: PASS and the raw-query inventory reports no PR-added runtime SQL.

- [ ] **Step 10: Commit**

```bash
git add packages/database/src apps/api/src/common/database apps/api/src/modules/booking-request apps/api/src/modules/night-audit apps/api/src/modules/reports
git commit -m "refactor(database): remove booking request runtime SQL"
```

---

### Task 8: Add a default-flow release gate and complete verification

**Files:**
- Create: `apps/api/src/modules/booking-request/booking-request-default-flow-regression.spec.ts`
- Modify: `docs/superpowers/specs/2026-08-24-booking-requests-design.md`
- Modify: `docs/superpowers/plans/2026-08-24-booking-requests.md`

**Interfaces:**
- Produces a compact merge gate proving `bookingMode: instant` does not activate request persistence or change legacy Stripe/folio behavior.
- Documents the optional-module boundary without claiming a separate package structure that maintainers have not selected.

- [ ] **Step 1: Add the cross-module default-flow regression test**

With migrated defaults, assert instant quote/booking/deposit behavior, no `booking_requests` row, successful full and partial Stripe-dashboard refunds, unchanged folio balance rules, and unrelated Stripe events acknowledged without writes.

- [ ] **Step 2: Run the gate against both modes**

Run: `pnpm --filter @telivityhaip/api test -- src/modules/booking-request/booking-request-default-flow-regression.spec.ts src/modules/booking-request/booking-request.e2e-spec.ts`

Expected: PASS for default instant and explicitly enabled request configurations.

- [ ] **Step 3: Record the module boundary in the spec**

State that request mode is opt-in at property configuration and module registration, while payment/folio invariants are shared and cannot be feature-gated. Do not move code into a separately published workspace package until maintainers choose among a Nest feature module, workspace package, or separately deployable integration.

- [ ] **Step 4: Run the full release gate**

Run:

```bash
pnpm build
pnpm typecheck
pnpm lint
DATABASE_URL=postgresql://haip:haip@localhost:5432/haip_test REDIS_URL=redis://localhost:6379 CI=true pnpm test
```

Expected: build and typecheck pass; lint has zero errors; all tests pass. If the known SMTP timing test fails only in the workspace run, rerun its package test once and report it separately rather than hiding it.

- [ ] **Step 5: Inspect the final diff against the merge base**

Run: `git diff --check 552ac622...HEAD`

Run: `git diff --stat 552ac622...HEAD`

Run: `git diff 552ac622...HEAD -- apps/api/src/modules/payment apps/api/src/modules/folio apps/api/src/modules/booking-engine apps/api/src/common/database`

Expected: no whitespace errors, no legacy-refund deletion, no policy downgrade, no unowned-event failure, and no runtime raw-SQL exception.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/booking-request/booking-request-default-flow-regression.spec.ts docs/superpowers
git commit -m "test(booking-requests): protect the default booking flow"
```

## Review and merge order

1. Tasks 1 and 2 are the hard default-flow gate. Do not ask for re-review before both pass.
2. Task 3 is the request-submission safety gate.
3. Tasks 4–6 close approved-spec and compliance gaps.
4. Task 7 is the repository-standards gate and should be reviewed independently because it changes concurrency and query shapes.
5. Task 8 is the final proof and documentation gate.
6. Packaging is a maintainer decision after these correctness gates. It must not be used to defer the Stripe, policy, audit, or SQL fixes because those touch shared core behavior.

## Self-review checklist

- Every P1 has a failing test before implementation: legacy refund, unrelated Stripe traffic, and fail-closed required-card behavior.
- Installment behavior now matches “edit or remove only the unallocated portion” rather than rejecting the entire record.
- Scale-three currency is rejected before persistence instead of during asynchronous financial reconciliation.
- Booking-engine request configuration modifications carry an authenticated actor and audit record.
- Every PR-added runtime raw query has a named Drizzle replacement; migrations and schema checks are explicitly scoped exceptions.
- Multi-tenancy filters remain present on payment, reservation, request, installment, allocation, and audit queries.
- The final gate tests default instant behavior and opt-in request behavior independently.
