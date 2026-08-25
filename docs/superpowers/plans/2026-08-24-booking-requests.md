# Request-first Direct Bookings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver an opt-in, end-to-end request-first booking flow with configurable applications, saved cards, manual partial payments, staff decisions, linked folios, email, dashboard, widget, and audited stay amendments.

**Architecture:** A new `BookingRequestModule` owns the request aggregate and exposes separate public-submission and staff-management interfaces. Existing booking-engine, reservation, payment, folio, email, audit, and webhook modules are extended through explicit seams; instant booking remains unchanged and request mode remains unreachable until the vertical slice is complete.

**Tech Stack:** TypeScript strict mode, NestJS, Drizzle ORM, PostgreSQL, Stripe SDK/Elements, React, TanStack Query, React Router, Vitest, Testing Library, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-08-24-booking-requests-design.md`

## Global Constraints

- Before Task 2, read the maintainer reply on issue #332 and the promised KB references. If either contradicts the spec, update and re-approve the spec before continuing.
- Never store raw card data; submission sends only a SetupIntent identifier and the server resolves trusted Stripe references.
- Every property-scoped read, update, and delete filters by both entity ID and caller-supplied `propertyId`.
- Public property scope comes only from the validated publishable booking credential.
- No automatic charges, request expiration, public request management, guest withdrawal, or authentication-recovery link.
- Acceptance creates a reservation independently of payment and is idempotent.
- Request mode defaults to `instant`; card collection defaults to `disabled`.
- Do not add runtime dependencies unless an existing package cannot satisfy an approved requirement.
- Business logic is test-first; every task ends with focused tests and a commit.

## File and module map

- `packages/database/src/schema/booking-request.ts`: request aggregate, installments, allocations, payment resolutions, and email deliveries.
- `packages/database/src/schema/booking-engine.ts`: request-mode, card-policy, and form-definition configuration.
- `packages/database/src/schema/folio.ts`: optional request provenance and idempotency on payment rows.
- `packages/database/src/migrations/0021_booking_requests.sql`: forward database migration and constraints.
- `apps/api/src/modules/booking-request/booking-request-state.ts`: pure request transitions and money-resolution rules.
- `apps/api/src/modules/booking-request/booking-request.service.ts`: submission, list/detail, acceptance, and denial orchestration.
- `apps/api/src/modules/booking-request/booking-request-payment.service.ts`: installments, charges, external payments, refunds, allocations, and denial resolution.
- `apps/api/src/modules/booking-request/booking-request-mailer.service.ts`: persistent transactional-email delivery and retry.
- `apps/api/src/modules/booking-request/booking-request.controller.ts`: staff API.
- `apps/api/src/modules/booking-request/booking-request-public.controller.ts`: publishable-key submission/setup API only.
- `apps/api/src/modules/payment/interfaces/saved-payment-method-gateway.interface.ts`: save-card and off-session-charge seam.
- `apps/api/src/modules/payment/stripe-saved-payment-method.gateway.ts`: Stripe implementation.
- `apps/api/src/modules/payment/mock-saved-payment-method.gateway.ts`: deterministic test/demo implementation.
- `apps/booking/src/pages/RequestApplication.tsx`: guest details plus configured questions.
- `apps/booking/src/pages/RequestPayment.tsx`: required/optional/disabled SetupIntent flow.
- `apps/booking/src/pages/RequestReceived.tsx`: acknowledgement without management credentials.
- `apps/dashboard/src/pages/BookingRequests.tsx`: queue and routed request detail.
- `apps/dashboard/src/components/booking-requests/*`: overview, payments, messages, audit, decisions, and stay amendment UI.
- `apps/dashboard/src/components/admin/BookingEngineSettings.tsx`: request-mode, card-policy, and question-builder settings.

---

### Task 1: Persist the aggregate and backward-compatible configuration

**Files:**
- Create: `packages/database/src/schema/booking-request.ts`
- Create: `packages/database/src/migrations/0021_booking_requests.sql`
- Create: `packages/database/src/booking-request-schema.spec.ts`
- Modify: `packages/database/src/schema/booking-engine.ts`
- Modify: `packages/database/src/schema/folio.ts`
- Modify: `packages/database/src/schema/index.ts`
- Modify: `packages/database/src/index.ts`
- Modify: `packages/database/src/push-schema.ts`

**Interfaces:**
- Produces: `BookingMode`, `PaymentMethodCollection`, `BookingFormQuestion`, `bookingRequests`, `bookingRequestInstallments`, `bookingRequestPaymentAllocations`, `bookingRequestPaymentResolutions`, and `bookingRequestEmailDeliveries`.
- Produces payment provenance fields: `payments.bookingRequestId` and `payments.idempotencyKey`.

- [ ] **Step 1: Write a failing schema contract test**

```ts
import { describe, expect, it } from 'vitest';
import {
  bookingEngineConfig,
  bookingRequests,
  bookingRequestInstallments,
  payments,
} from './schema/index.js';

describe('booking request schema', () => {
  it('exports request persistence and backward-compatible config columns', () => {
    expect(bookingRequests.propertyId).toBeDefined();
    expect(bookingRequests.submittedQuoteSnapshot).toBeDefined();
    expect(bookingRequestInstallments.dueMilestone).toBeDefined();
    expect(bookingEngineConfig.bookingMode).toBeDefined();
    expect(bookingEngineConfig.paymentMethodCollection).toBeDefined();
    expect(payments.bookingRequestId).toBeDefined();
    expect(payments.idempotencyKey).toBeDefined();
  });
});
```

- [ ] **Step 2: Run the schema test and verify it fails**

Run: `pnpm --filter @telivityhaip/database test -- src/booking-request-schema.spec.ts`
Expected: FAIL because the request tables and columns are not exported.

- [ ] **Step 3: Define shared configuration and form types**

```ts
export type BookingMode = 'instant' | 'request';
export type PaymentMethodCollection = 'required' | 'optional' | 'disabled';
export type BookingFormQuestionType =
  | 'short_text'
  | 'long_text'
  | 'single_select'
  | 'multi_select'
  | 'yes_no'
  | 'date';

export type BookingFormQuestion = {
  id: string;
  label: string;
  type: BookingFormQuestionType;
  options?: string[];
  order: number;
  isActive: boolean;
  isRequired: boolean;
};
```

Add `bookingMode`, `paymentMethodCollection`, and `formQuestions` to `bookingEngineConfig`, defaulting to `instant`, `disabled`, and `[]`.

- [ ] **Step 4: Define request persistence with explicit enums and unique constraints**

```ts
export const bookingRequestStatusEnum = pgEnum('booking_request_status', [
  'pending',
  'accepted',
  'denied',
]);

export const bookingRequestPriceSourceEnum = pgEnum('booking_request_price_source', [
  'submitted',
  'current',
  'custom',
]);

export const bookingRequests = pgTable('booking_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  propertyId: uuid('property_id').notNull().references(() => properties.id),
  status: bookingRequestStatusEnum('status').notNull().default('pending'),
  arrivalDate: date('arrival_date').notNull(),
  departureDate: date('departure_date').notNull(),
  roomTypeId: uuid('room_type_id').notNull().references(() => roomTypes.id),
  ratePlanId: uuid('rate_plan_id').notNull().references(() => ratePlans.id),
  adults: integer('adults').notNull().default(1),
  children: integer('children').notNull().default(0),
  guestFirstName: varchar('guest_first_name', { length: 100 }).notNull(),
  guestLastName: varchar('guest_last_name', { length: 100 }).notNull(),
  guestEmail: varchar('guest_email', { length: 255 }).notNull(),
  guestPhone: varchar('guest_phone', { length: 50 }),
  specialRequests: text('special_requests'),
  serviceIds: jsonb('service_ids').$type<string[]>().notNull().default([]),
  formSnapshot: jsonb('form_snapshot').$type<BookingFormQuestion[]>().notNull().default([]),
  applicationAnswers: jsonb('application_answers').$type<Record<string, unknown>>().notNull().default({}),
  submittedQuoteSnapshot: jsonb('submitted_quote_snapshot').notNull(),
  currentQuoteSnapshot: jsonb('current_quote_snapshot'),
  currencyCode: varchar('currency_code', { length: 3 }).notNull(),
  stripeCustomerId: varchar('stripe_customer_id', { length: 255 }),
  stripePaymentMethodId: varchar('stripe_payment_method_id', { length: 255 }),
  cardLastFour: varchar('card_last_four', { length: 4 }),
  cardBrand: varchar('card_brand', { length: 20 }),
  consentText: text('consent_text'),
  consentVersion: varchar('consent_version', { length: 40 }),
  consentedAt: timestamp('consented_at', { withTimezone: true }),
  acceptedPriceSource: bookingRequestPriceSourceEnum('accepted_price_source'),
  acceptedTotal: numeric('accepted_total', { precision: 12, scale: 2 }),
  customPriceReason: text('custom_price_reason'),
  acceptedReservationId: uuid('accepted_reservation_id').references(() => reservations.id),
  acceptedFolioId: uuid('accepted_folio_id').references(() => folios.id),
  decidedBy: uuid('decided_by'),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  denialReason: text('denial_reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  acceptedReservationUnique: uniqueIndex('booking_requests_accepted_reservation_unique')
    .on(table.acceptedReservationId),
}));
```

Define installment, allocation, payment-resolution, and email-delivery tables with `propertyId` on every row. Add a unique `(propertyId, idempotencyKey)` index for payments and a database check that a payment has a folio, house account, or Booking Request target.

- [ ] **Step 5: Write migration `0021_booking_requests.sql`**

The migration must create the enums/tables/indexes/FKs, add the three booking-engine columns and two payment columns, backfill existing config rows to `instant`/`disabled`/`[]`, and mark the new config columns `NOT NULL` only after backfill.

- [ ] **Step 6: Apply the migration to the test database and run the schema test**

Run: `DATABASE_URL=postgresql://haip:haip@localhost:5432/haip_test pnpm db:migrate`
Run: `pnpm --filter @telivityhaip/database test -- src/booking-request-schema.spec.ts`
Expected: migration succeeds and the test passes.

- [ ] **Step 7: Commit**

```bash
git add packages/database/src
git commit -m "feat(database): add booking request persistence"
```

---

### Task 2: Implement the pure request and installment domain model

**Files:**
- Create: `apps/api/src/modules/booking-request/booking-request-state.ts`
- Create: `apps/api/src/modules/booking-request/booking-request-state.spec.ts`
- Create: `apps/api/src/modules/booking-request/booking-request-money.ts`
- Create: `apps/api/src/modules/booking-request/booking-request-money.spec.ts`

**Interfaces:**
- Produces: `assertBookingRequestTransition(from, to)`.
- Produces: `resolveAcceptedTotal(input): { source; total; customReason }`.
- Produces: `resolveInstallmentAmount(input): Decimal`.
- Produces: `assertDenialMoneyResolved(movements, resolutions): void`.

- [ ] **Step 1: Write failing transition and pricing tests**

```ts
it('allows only pending to accepted or denied', () => {
  expect(() => assertBookingRequestTransition('pending', 'accepted')).not.toThrow();
  expect(() => assertBookingRequestTransition('pending', 'denied')).not.toThrow();
  expect(() => assertBookingRequestTransition('accepted', 'denied')).toThrow(/accepted/);
});

it('requires a reason for a custom accepted price', () => {
  expect(() => resolveAcceptedTotal({
    source: 'custom',
    submittedTotal: '1000.00',
    currentTotal: '1100.00',
    customTotal: '1050.00',
  })).toThrow(/reason/);
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run: `pnpm --filter @telivityhaip/api test -- src/modules/booking-request/booking-request-state.spec.ts src/modules/booking-request/booking-request-money.spec.ts`
Expected: FAIL because the pure functions do not exist.

- [ ] **Step 3: Implement explicit state and money functions**

```ts
export type BookingRequestStatus = 'pending' | 'accepted' | 'denied';

export function assertBookingRequestTransition(
  from: BookingRequestStatus,
  to: Exclude<BookingRequestStatus, 'pending'>,
): void {
  if (from !== 'pending') {
    throw new ConflictException(`Cannot transition booking request from '${from}' to '${to}'`);
  }
}
```

Use `Decimal` for every amount and percentage. Reject non-positive custom totals, fixed installments, allocations, payments, and refunds. `assertDenialMoneyResolved` compares each captured movement's net amount with returned plus retained resolutions.

- [ ] **Step 4: Add edge-case tests**

Cover percentage rounding to currency precision, allocations that exceed movement/installment amounts, refund totals over net capture, zero amounts, and unresolved partial denial balances.

- [ ] **Step 5: Run focused tests**

Run: `pnpm --filter @telivityhaip/api test -- src/modules/booking-request/booking-request-state.spec.ts src/modules/booking-request/booking-request-money.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/booking-request/booking-request-state.ts apps/api/src/modules/booking-request/booking-request-state.spec.ts apps/api/src/modules/booking-request/booking-request-money.ts apps/api/src/modules/booking-request/booking-request-money.spec.ts
git commit -m "feat(booking-requests): define lifecycle and money rules"
```

---

### Task 3: Extend Booking Engine Settings and validate custom questions

**Files:**
- Create: `apps/api/src/modules/booking-engine/booking-form-questions.ts`
- Create: `apps/api/src/modules/booking-engine/booking-form-questions.spec.ts`
- Modify: `apps/api/src/modules/booking-engine/dto/be-admin.dto.ts`
- Modify: `apps/api/src/modules/booking-engine/booking-engine-config.service.ts`
- Modify: `apps/api/src/modules/booking-engine/booking-engine.service.spec.ts`

**Interfaces:**
- Produces: `validateQuestionDefinitions(questions): BookingFormQuestion[]`.
- Produces: `validateApplicationAnswers(questions, answers): Record<string, unknown>`.
- Extends `UpdateConfigInput` and public config with `bookingMode`, `paymentMethodCollection`, and active ordered questions.

- [ ] **Step 1: Write failing validation tests**

```ts
it('rejects duplicate question ids and missing select options', () => {
  expect(() => validateQuestionDefinitions([
    { id: 'purpose', label: 'Purpose', type: 'single_select', options: [], order: 0, isActive: true, isRequired: true },
    { id: 'purpose', label: 'Again', type: 'short_text', order: 1, isActive: true, isRequired: false },
  ])).toThrow();
});

it('rejects a missing required answer', () => {
  expect(() => validateApplicationAnswers([
    { id: 'arrival', label: 'Arrival time', type: 'short_text', order: 0, isActive: true, isRequired: true },
  ], {})).toThrow(/Arrival time/);
});
```

- [ ] **Step 2: Run and verify failure**

Run: `pnpm --filter @telivityhaip/api test -- src/modules/booking-engine/booking-form-questions.spec.ts`
Expected: FAIL because validation is missing.

- [ ] **Step 3: Add nested DTO validation and pure value validation**

Create `BookingFormQuestionDto` with `@IsIn`, `@IsUUID`, `@MaxLength`, `@IsArray`, `@ArrayMaxSize`, and nested validation. Enforce unique IDs, unique normalized options, maximum 50 questions, and type-correct answers.

- [ ] **Step 4: Extend config read/update behavior**

Admin config returns all definitions. Public config returns only active questions sorted by `order`, plus booking/card modes. Reject `bookingMode=request` with `paymentMethodCollection=required` when no publishable card key is configured.

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @telivityhaip/api test -- src/modules/booking-engine/booking-form-questions.spec.ts src/modules/booking-engine/booking-engine.service.spec.ts`
Expected: PASS, including unchanged instant-mode expectations.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/booking-engine
git commit -m "feat(booking-engine): configure request forms"
```

---

### Task 4: Add the saved-payment-method gateway seam

**Files:**
- Create: `apps/api/src/modules/payment/interfaces/saved-payment-method-gateway.interface.ts`
- Create: `apps/api/src/modules/payment/stripe-saved-payment-method.gateway.ts`
- Create: `apps/api/src/modules/payment/stripe-saved-payment-method.gateway.spec.ts`
- Create: `apps/api/src/modules/payment/mock-saved-payment-method.gateway.ts`
- Create: `apps/api/src/modules/payment/mock-saved-payment-method.gateway.spec.ts`
- Modify: `apps/api/src/modules/payment/payment.module.ts`

**Interfaces:**
- Produces `SAVED_PAYMENT_METHOD_GATEWAY` implementing the following interface.

```ts
export type SavedPaymentMethod = {
  setupIntentId: string;
  customerId: string;
  paymentMethodId: string;
  cardLastFour: string;
  cardBrand: string;
};

export interface SavedPaymentMethodGateway {
  createSetup(email: string, idempotencyKey: string): Promise<{
    setupIntentId: string;
    clientSecret: string;
    customerId: string;
  }>;
  resolveSetup(setupIntentId: string): Promise<SavedPaymentMethod>;
  charge(input: {
    customerId: string;
    paymentMethodId: string;
    amount: string;
    currencyCode: string;
    idempotencyKey: string;
  }): Promise<{ success: boolean; transactionId: string; requiresAction: boolean; errorMessage?: string }>;
}
```

- [ ] **Step 1: Write failing adapter tests**

Test SetupIntent creation with `usage: 'off_session'`, resolution only when status is `succeeded`, trusted retrieval of card metadata, automatic-capture off-session PaymentIntent creation, idempotency propagation, and `requires_action` mapping to failure.

- [ ] **Step 2: Run and verify failure**

Run: `pnpm --filter @telivityhaip/api test -- src/modules/payment/stripe-saved-payment-method.gateway.spec.ts src/modules/payment/mock-saved-payment-method.gateway.spec.ts`
Expected: FAIL because adapters are missing.

- [ ] **Step 3: Implement Stripe and mock adapters**

The Stripe adapter creates a Customer and SetupIntent, retrieves the successful SetupIntent and expanded PaymentMethod, and later creates a confirmed off-session PaymentIntent with automatic capture. It returns failure instead of a client secret when later authentication is required.

- [ ] **Step 4: Register the seam**

In mock mode inject `MockSavedPaymentMethodGateway`; in Stripe mode inject `StripeSavedPaymentMethodGateway`. Export only the symbol/interface from `PaymentModule`.

- [ ] **Step 5: Run focused tests and typecheck**

Run: `pnpm --filter @telivityhaip/api test -- src/modules/payment/stripe-saved-payment-method.gateway.spec.ts src/modules/payment/mock-saved-payment-method.gateway.spec.ts`
Run: `pnpm --filter @telivityhaip/api typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/payment
git commit -m "feat(payments): save and charge request payment methods"
```

---

### Task 5: Create public request setup and submission

**Files:**
- Create: `apps/api/src/modules/booking-request/dto/submit-booking-request.dto.ts`
- Create: `apps/api/src/modules/booking-request/dto/create-request-card-setup.dto.ts`
- Create: `apps/api/src/modules/booking-request/booking-request-public.controller.ts`
- Create: `apps/api/src/modules/booking-request/booking-request.service.ts`
- Create: `apps/api/src/modules/booking-request/booking-request-submission.spec.ts`
- Create: `apps/api/src/modules/booking-request/booking-request.module.ts`
- Modify: `apps/api/src/modules/booking-engine/booking-engine.module.ts`
- Modify: `apps/api/src/modules/booking-engine/booking-engine.service.ts`
- Modify: `apps/api/src/modules/booking-engine/booking-engine.service.spec.ts`
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**
- Produces `BookingRequestService.submit(propertyId, dto): Promise<BookingRequestAcknowledgement>`.
- Produces public routes `POST /booking-engine/request-payment-method-setup` and `POST /booking-engine/requests`.

```ts
export type BookingRequestAcknowledgement = {
  requestId: string;
  status: 'pending';
  message: string;
};
```

- [ ] **Step 1: Write failing submission tests**

Cover request submission rejection in instant mode, card setup rejection when request mode/card collection is unavailable, zero availability, stale/invalid rate plan, required/optional/disabled card policies, form-answer validation, authoritative quote snapshot, trusted SetupIntent resolution, and absence of guest/reservation/folio writes. Add a regression proving `BookingEngineService.book` rejects when the property's mode is `request`, so callers cannot bypass review by invoking the old instant endpoint directly.

- [ ] **Step 2: Run and verify failure**

Run: `pnpm --filter @telivityhaip/api test -- src/modules/booking-request/booking-request-submission.spec.ts`
Expected: FAIL because the module and service do not exist.

- [ ] **Step 3: Implement public DTOs and controller**

```ts
@ApiTags('Booking Engine — Booking Requests')
@Controller('booking-engine')
@Public()
@UseGuards(BookingKeyGuard, BookingEngineScopeGuard)
export class BookingRequestPublicController {
  @Post('request-payment-method-setup')
  createSetup(@Body() dto: CreateRequestCardSetupDto, @Req() req: any) {
    return this.service.createPaymentMethodSetup(req.bookingEngine.propertyId, dto);
  }

  @Post('requests')
  @UseGuards(BookingThrottleGuard)
  submit(@Body() dto: SubmitBookingRequestDto, @Req() req: any) {
    return this.service.submit(req.bookingEngine.propertyId, dto);
  }
}
```

- [ ] **Step 4: Implement server-authoritative submission**

Load public config, require request mode, validate answers, call `RatePlanService.assertSellable`, check availability, call existing `BookingEngineService.quote`, resolve SetupIntent according to policy, insert immutable snapshots, emit `booking_request.created`, and return only the acknowledgement. In the existing `BookingEngineService.book`, require `bookingMode === 'instant'` before creating any guest, reservation, folio, or payment.

- [ ] **Step 5: Run tests and confirm no instant regression**

Run: `pnpm --filter @telivityhaip/api test -- src/modules/booking-request/booking-request-submission.spec.ts src/modules/booking-engine/booking-engine.service.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/booking-request apps/api/src/modules/booking-engine/booking-engine.module.ts apps/api/src/modules/booking-engine/booking-engine.service.ts apps/api/src/modules/booking-engine/booking-engine.service.spec.ts apps/api/src/app.module.ts
git commit -m "feat(booking-requests): accept public submissions"
```

---

### Task 6: Implement staff reads, acceptance, and denial

**Files:**
- Create: `apps/api/src/modules/booking-request/dto/list-booking-requests.dto.ts`
- Create: `apps/api/src/modules/booking-request/dto/accept-booking-request.dto.ts`
- Create: `apps/api/src/modules/booking-request/dto/deny-booking-request.dto.ts`
- Create: `apps/api/src/modules/booking-request/booking-request.controller.ts`
- Create: `apps/api/src/modules/booking-request/booking-request-decision.spec.ts`
- Modify: `apps/api/src/modules/booking-request/booking-request.service.ts`
- Modify: `apps/api/src/modules/booking-request/booking-request.module.ts`
- Modify: `apps/api/src/modules/reservation/reservation.service.ts`
- Modify: `apps/api/src/modules/folio/folio.service.ts`
- Modify: `apps/api/src/modules/guest/guest.service.ts`
- Modify: `apps/api/src/modules/ancillary/ancillary.service.ts`

**Interfaces:**
- Produces `list`, `findById`, `accept`, and `deny` on `BookingRequestService`.
- Extends canonical reservation/folio creation to accept a caller transaction without changing existing callers.

```ts
export type AcceptBookingRequestInput = {
  priceSource: 'submitted' | 'current' | 'custom';
  customTotal?: string;
  customReason?: string;
};

export type AuditActor = {
  userId?: string;
  userEmail?: string;
  ipAddress?: string;
};
```

- [ ] **Step 1: Write failing tenant, permission, and concurrency tests**

Test `reservations.read` on list/detail; `reservations.write` on accept/deny; required `propertyId`; cross-property IDs returning not found; repricing choices; missing custom reason; no availability leaving `pending`; two concurrent accepts producing one reservation; accepted retry returning the linked reservation; and unresolved money blocking denial.

- [ ] **Step 2: Run and verify failure**

Run: `pnpm --filter @telivityhaip/api test -- src/modules/booking-request/booking-request-decision.spec.ts`
Expected: FAIL because staff behavior is missing.

- [ ] **Step 3: Add transaction-aware canonical creation**

Change `GuestService.create(dto, tx?)`, `ReservationService.create(dto, opts, tx?)`, its internal FK/sellability/availability lookups, `FolioService.createAutoFolio(reservation, tx?)`, and the ancillary attach/ensure methods used by direct booking to use `tx ?? this.db`. Let the reservation caller suppress immediate webhook emission when an outer transaction is active; emit only after the outer commit. Preserve every existing caller and test.

- [ ] **Step 4: Implement idempotent acceptance**

Inside one database transaction, lock the property-scoped request, return its linked reservation when already accepted, reject denied, re-quote/recheck availability, resolve the accepted total, create guest/reservation/folio and selected ancillary links through transaction-aware canonical methods, link pre-acceptance payments to the folio, and atomically mark accepted. Emit webhook/audit after commit.

- [ ] **Step 5: Implement denial with money-resolution guard**

Lock the request, call `assertDenialMoneyResolved`, record reason/actor, and transition pending to denied. Never delete payments or the request.

- [ ] **Step 6: Run focused and reservation regression tests**

Run: `pnpm --filter @telivityhaip/api test -- src/modules/booking-request/booking-request-decision.spec.ts src/modules/reservation/reservation-race.spec.ts src/modules/reservation/reservation-assert-sellable.spec.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/booking-request apps/api/src/modules/reservation/reservation.service.ts apps/api/src/modules/folio/folio.service.ts apps/api/src/modules/guest/guest.service.ts apps/api/src/modules/ancillary/ancillary.service.ts
git commit -m "feat(booking-requests): review and convert requests"
```

---

### Task 7: Implement installments and request-targeted payment operations

**Files:**
- Create: `apps/api/src/modules/booking-request/dto/booking-request-payment.dto.ts`
- Create: `apps/api/src/modules/booking-request/booking-request-payment.service.ts`
- Create: `apps/api/src/modules/booking-request/booking-request-payment.spec.ts`
- Modify: `apps/api/src/modules/booking-request/booking-request.controller.ts`
- Modify: `apps/api/src/modules/booking-request/booking-request.module.ts`
- Modify: `apps/api/src/modules/payment/payment.service.ts`
- Modify: `apps/api/src/modules/payment/payment-ledger.ts`
- Modify: `apps/api/src/modules/payment/payment.service.spec.ts`

**Interfaces:**
- Produces installment CRUD/allocation methods.
- Produces `chargeSavedCard`, `recordExternalPayment`, `refund`, `recordExternalReturn`, and `retainForDenial` methods.

- [ ] **Step 1: Write failing financial tests**

Cover fixed/percentage installments, several partial movements, manual/date/arrival/checkout milestones, no scheduled side effects, zero/negative rejection, gateway success/failure, additional-auth failure, stable idempotency, duplicate external references, partial refunds, external returns, retained amounts with reason, and folio relinking after acceptance.

- [ ] **Step 2: Run and verify failure**

Run: `pnpm --filter @telivityhaip/api test -- src/modules/booking-request/booking-request-payment.spec.ts`
Expected: FAIL because the payment service is missing.

- [ ] **Step 3: Implement installment persistence and allocation**

Use database locks when allocating. Recompute each installment's derived unpaid/partial/paid state from allocation sums. Editing or deletion rejects allocated amounts.

- [ ] **Step 4: Implement gateway charge as a two-phase operation**

Insert a `pending` payment with property/request scope and idempotency key, commit, call `SavedPaymentMethodGateway.charge`, then atomically update to `captured` or `failed`. A repeated key returns the existing row and never calls the gateway again.

- [ ] **Step 5: Implement external movements and resolutions**

Record external payments as captured ledger rows with processed date/reference. Reuse existing refund ledger semantics for gateway refunds. Add explicit external-return and retained-resolution rows so denial can prove every net captured amount is resolved.

- [ ] **Step 6: Run payment regression tests**

Run: `pnpm --filter @telivityhaip/api test -- src/modules/booking-request/booking-request-payment.spec.ts src/modules/payment/payment.service.spec.ts src/modules/payment/payment-ledger.spec.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/booking-request apps/api/src/modules/payment
git commit -m "feat(booking-requests): manage partial payments"
```

---

### Task 8: Persist transactional email and audit/webhook consequences

**Files:**
- Create: `apps/api/src/modules/booking-request/booking-request-mailer.service.ts`
- Create: `apps/api/src/modules/booking-request/booking-request-mailer.spec.ts`
- Create: `apps/api/src/modules/booking-request/booking-request-email.templates.ts`
- Modify: `apps/api/src/modules/booking-request/booking-request.service.ts`
- Modify: `apps/api/src/modules/booking-request/booking-request-payment.service.ts`
- Modify: `apps/api/src/modules/booking-request/booking-request.controller.ts`
- Modify: `apps/api/src/modules/booking-request/booking-request.module.ts`
- Modify: `apps/api/src/modules/agent/guest-comms/email.module.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Produces `queue`, `deliver`, `retry`, and `listForRequest` on `BookingRequestMailerService`.
- Adds typed webhook events for request created/accepted/denied while reusing payment and reservation events.

- [ ] **Step 1: Write failing delivery tests**

Test receipt, accepted, denied, payment, refund, and failure templates; persisted pending-before-send behavior; sent/failed results; retry; no rollback of the originating action; and absence of request-management or authentication links.

- [ ] **Step 2: Run and verify failure**

Run: `pnpm --filter @telivityhaip/api test -- src/modules/booking-request/booking-request-mailer.spec.ts`
Expected: FAIL because persistent delivery is missing.

- [ ] **Step 3: Implement persistent delivery**

```ts
async queue(input: QueueBookingRequestEmail): Promise<string> {
  const [delivery] = await this.db.insert(bookingRequestEmailDeliveries).values({
    propertyId: input.propertyId,
    bookingRequestId: input.bookingRequestId,
    kind: input.kind,
    recipient: input.recipient,
    subject: input.subject,
    bodyText: input.bodyText,
    status: 'pending',
  }).returning({ id: bookingRequestEmailDeliveries.id });
  return delivery.id;
}
```

`deliver` loads by both delivery ID and `propertyId`, calls `EmailService`, and writes sent/failed state without throwing into the completed business transaction.

- [ ] **Step 4: Wire consequences after committed actions**

Submission, accept, deny, charge, external payment, refund, and failure queue/deliver their messages and emit sanitized webhook/audit payloads. Exclude answers, consent text, and payment tokens.

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @telivityhaip/api test -- src/modules/booking-request/booking-request-mailer.spec.ts src/modules/booking-request/booking-request-decision.spec.ts src/modules/booking-request/booking-request-payment.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/booking-request apps/api/src/modules/agent/guest-comms/email.module.ts packages/shared/src/index.ts
git commit -m "feat(booking-requests): send audited request emails"
```

---

### Task 9: Build the three-step public widget flow

**Files:**
- Create: `apps/booking/src/pages/RequestApplication.tsx`
- Create: `apps/booking/src/pages/RequestApplication.test.tsx`
- Create: `apps/booking/src/pages/RequestPayment.tsx`
- Create: `apps/booking/src/pages/RequestPayment.test.tsx`
- Create: `apps/booking/src/pages/RequestReceived.tsx`
- Create: `apps/booking/src/components/ConfiguredQuestion.tsx`
- Create: `apps/booking/src/components/StripeSetupForm.tsx`
- Modify: `apps/booking/src/App.tsx`
- Modify: `apps/booking/src/api/client.ts`
- Modify: `apps/booking/src/api/types.ts`
- Modify: `apps/booking/src/context/BookingFlowContext.tsx`
- Modify: `apps/booking/src/pages/GuestDetails.tsx`
- Modify: `apps/booking/src/pages/Payment.tsx`
- Modify: `apps/booking/src/pages/Confirmation.tsx`

**Interfaces:**
- Adds `bookingMode`, `paymentMethodCollection`, and `formQuestions` to `BookingConfig`.
- Adds `applicationAnswers`, `setupIntentId`, and request acknowledgement to booking flow state.
- Preserves the existing instant routes and components.

- [ ] **Step 1: Write failing widget tests**

Test instant mode unchanged; request application rendering all six question types; required validation; immutable state while navigating back; disabled skipping card UI; optional explicit skip; required blocking without successful setup; consent copy; request submission; and receipt page without manage link.

- [ ] **Step 2: Run and verify failure**

Run: `pnpm --filter @telivityhaip/booking test -- src/pages/RequestApplication.test.tsx src/pages/RequestPayment.test.tsx`
Expected: FAIL because request pages are missing.

- [ ] **Step 3: Extend typed client and flow state**

Add `bookingApi.createRequestPaymentMethodSetup` and `bookingApi.submitRequest`. Keep `bookingApi.book` untouched. Store answers and setup result in context; clear them in `reset`.

- [ ] **Step 4: Implement mode-aware three-step routing**

Search/results/room/extras remain shared. After selection, request mode routes to `/request/application`, then `/request/payment` when card policy is required/optional, then `/request/received`. Disabled card collection submits from the application confirmation action without loading Stripe.

- [ ] **Step 5: Implement Stripe setup and consent**

Render Payment Element with the server client secret and call `stripe.confirmSetup`. Submit only the SetupIntent ID; do not submit PaymentMethod IDs or card metadata from the browser.

- [ ] **Step 6: Run widget suite**

Run: `pnpm --filter @telivityhaip/booking test`
Run: `pnpm --filter @telivityhaip/booking typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/booking/src
git commit -m "feat(booking-widget): submit booking requests"
```

---

### Task 10: Add request configuration and question builder to the dashboard

**Files:**
- Create: `apps/dashboard/src/components/admin/BookingQuestionBuilder.tsx`
- Create: `apps/dashboard/src/components/admin/BookingQuestionBuilder.test.tsx`
- Modify: `apps/dashboard/src/components/admin/BookingEngineSettings.tsx`
- Modify: `apps/dashboard/src/locales/en.json`
- Modify: `apps/dashboard/src/locales/es.json`
- Modify: `apps/dashboard/src/locales/de.json`
- Modify: `apps/dashboard/src/locales/fr.json`
- Modify: `apps/dashboard/src/locales/hr.json`
- Modify: `apps/dashboard/src/locales/it.json`
- Modify: `apps/dashboard/src/locales/pt-BR.json`
- Modify: `apps/dashboard/src/locales/sr-Latn.json`

**Interfaces:**
- Consumes admin booking config from Task 3.
- Produces settings UI for booking mode, card policy, and ordered question definitions.

- [ ] **Step 1: Write failing settings tests**

Test defaults, mode/card-policy selectors, required-card warning without a key, add/edit/remove/reorder/disable question, per-type option editor, duplicate ID prevention, and saved payload shape.

- [ ] **Step 2: Run and verify failure**

Run: `pnpm --filter @telivityhaip/dashboard test -- src/components/admin/BookingQuestionBuilder.test.tsx`
Expected: FAIL because the builder is missing.

- [ ] **Step 3: Implement the question builder**

Use stable UUIDs generated when a question is created. Reordering changes only `order`; disabling retains historical identity. Show option editing only for single/multiple select.

- [ ] **Step 4: Integrate settings and translations**

Add request configuration near the existing enabled/auto-confirm controls and translate every new visible string in all supported locale files.

- [ ] **Step 5: Run dashboard tests and typecheck**

Run: `pnpm --filter @telivityhaip/dashboard test -- src/components/admin/BookingQuestionBuilder.test.tsx`
Run: `pnpm --filter @telivityhaip/dashboard typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/components/admin apps/dashboard/src/locales
git commit -m "feat(dashboard): configure booking request forms"
```

---

### Task 11: Build the request queue and dedicated detail workspace

**Files:**
- Create: `apps/dashboard/src/pages/BookingRequests.tsx`
- Create: `apps/dashboard/src/pages/BookingRequests.test.tsx`
- Create: `apps/dashboard/src/components/booking-requests/RequestOverview.tsx`
- Create: `apps/dashboard/src/components/booking-requests/RequestPayments.tsx`
- Create: `apps/dashboard/src/components/booking-requests/RequestMessages.tsx`
- Create: `apps/dashboard/src/components/booking-requests/RequestAudit.tsx`
- Create: `apps/dashboard/src/components/booking-requests/AcceptRequestModal.tsx`
- Create: `apps/dashboard/src/components/booking-requests/DenyRequestModal.tsx`
- Create: `apps/dashboard/src/components/booking-requests/PaymentActionModal.tsx`
- Modify: `apps/dashboard/src/App.tsx`
- Modify: `apps/dashboard/src/components/layout/Sidebar.tsx`
- Modify: `apps/dashboard/src/components/layout/Sidebar.test.tsx`
- Modify: `apps/dashboard/src/hooks/useRealtimeInvalidation.ts`
- Modify: all `apps/dashboard/src/locales/*.json`

**Interfaces:**
- Consumes staff request/payment/message endpoints from Tasks 6–8.
- Produces `/booking-requests` queue and `/booking-requests/:id` tabbed detail routes.

- [ ] **Step 1: Write failing page tests**

Test permission-gated navigation, property-scoped queries, queue filters, card/status/amount cells, tab routing, submitted/current price comparison, custom price reason, duplicate-click disabling, denial resolution blocking, installment editing, Stripe/external action separation, positive amount validation, refund/retain UI, email retry, and audit display.

- [ ] **Step 2: Run and verify failure**

Run: `pnpm --filter @telivityhaip/dashboard test -- src/pages/BookingRequests.test.tsx src/components/layout/Sidebar.test.tsx`
Expected: FAIL because routes and pages are missing.

- [ ] **Step 3: Implement queue and routing**

Add a `reservations.read` navigation item under Front Desk. Build list and detail routes using TanStack Query keys containing `propertyId`, filters, and request ID.

- [ ] **Step 4: Implement option-B detail tabs and actions**

Keep Accept/Deny visible in the header. Use separate mutation modals for decisions and money. Payments & plan shows request movements before acceptance and the linked folio summary after acceptance.

- [ ] **Step 5: Add realtime invalidation and translations**

Map `booking_request.*`, `payment.*`, and linked `reservation.*` events to request queue/detail, payment, folio, message, and audit query keys.

- [ ] **Step 6: Run dashboard suite and typecheck**

Run: `pnpm --filter @telivityhaip/dashboard test`
Run: `pnpm --filter @telivityhaip/dashboard typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/dashboard/src
git commit -m "feat(dashboard): manage booking requests"
```

---

### Task 12: Add audited stay amendments from accepted requests

**Files:**
- Create: `apps/api/src/modules/booking-request/dto/amend-booking-request-stay.dto.ts`
- Create: `apps/api/src/modules/booking-request/booking-request-amendment.spec.ts`
- Modify: `apps/api/src/modules/booking-request/booking-request.service.ts`
- Modify: `apps/api/src/modules/booking-request/booking-request.controller.ts`
- Modify: `apps/api/src/modules/reservation/dto/modify-reservation.dto.ts`
- Modify: `apps/api/src/modules/reservation/reservation.service.ts`
- Create: `apps/dashboard/src/components/booking-requests/ModifyStayModal.tsx`
- Create: `apps/dashboard/src/components/booking-requests/ModifyStayModal.test.tsx`
- Modify: `apps/dashboard/src/components/booking-requests/RequestOverview.tsx`
- Modify: `apps/dashboard/src/components/booking-requests/RequestPayments.tsx`

**Interfaces:**
- Produces `BookingRequestService.amendStay(requestId, propertyId, input, actor)`.
- Reuses the submitted/current/custom price-choice contract and the existing reservation modification behavior.

- [ ] **Step 1: Write failing amendment tests**

Cover accepted-only behavior, property scope, complete-window availability, extension and shortening, authoritative repricing, three price choices, custom reason, unchanged original request snapshots/accepted price, reservation totals/dates update, folio summary refresh, audit values, webhook, and no duplicate room-revenue posting.

- [ ] **Step 2: Run and verify failure**

Run: `pnpm --filter @telivityhaip/api test -- src/modules/booking-request/booking-request-amendment.spec.ts`
Expected: FAIL because amendment orchestration is missing.

- [ ] **Step 3: Extract a reusable reservation amendment result**

```ts
export type ReservationAmendmentResult = {
  reservation: ReservationRow;
  previousArrivalDate: string;
  previousDepartureDate: string;
  previousTotalAmount: string;
  newTotalAmount: string;
};
```

Extend `ReservationService.modify` to return this audit-ready result while preserving controller response compatibility.

- [ ] **Step 4: Implement request-linked amendment orchestration**

Load accepted request/reservation by property, quote the new stay, resolve price source, call canonical modification, insert an audit log with old/new dates and totals, and emit `reservation.modified`. Never update submitted/current/accepted request quote fields.

- [ ] **Step 5: Implement dashboard modal**

Show old/new dates, submitted accepted price, current quote, custom price and reason. On success invalidate request, reservation, availability, folio, and audit queries.

- [ ] **Step 6: Run API and dashboard tests**

Run: `pnpm --filter @telivityhaip/api test -- src/modules/booking-request/booking-request-amendment.spec.ts src/modules/reservation/reservation-ops.spec.ts`
Run: `pnpm --filter @telivityhaip/dashboard test -- src/components/booking-requests/ModifyStayModal.test.tsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/booking-request apps/api/src/modules/reservation apps/dashboard/src/components/booking-requests
git commit -m "feat(booking-requests): amend accepted stays"
```

---

### Task 13: Verify the complete vertical slice and rollout guard

**Files:**
- Create: `apps/api/src/modules/booking-request/booking-request.e2e-spec.ts`
- Create: `apps/booking/src/pages/RequestFlow.e2e.test.tsx`
- Modify: `README.md`
- Modify: `docs/test-stats.json`
- Modify: `docs/superpowers/specs/2026-08-24-booking-requests-design.md` only if the maintainer/KB confirmation requires an approved clarification.

**Interfaces:**
- Verifies all preceding task interfaces together.
- Produces no new production interface.

- [ ] **Step 1: Write the end-to-end API test**

The test configures request mode/questions, submits with a saved card, verifies no reservation, creates 30/70 installments, takes a partial card payment, accepts with current price, records an external payment, posts a folio extra, extends the stay, and verifies request/reservation/folio/payment/email/audit state.

- [ ] **Step 2: Run the end-to-end test and fix only integration defects**

Run: `DATABASE_URL=postgresql://haip:haip@localhost:5432/haip_test REDIS_URL=redis://localhost:6379 CI=true pnpm --filter @telivityhaip/api test -- src/modules/booking-request/booking-request.e2e-spec.ts`
Expected: PASS.

- [ ] **Step 3: Add widget flow integration coverage**

Exercise request and instant configurations with mocked API/Stripe boundaries. Assert that disabled mode never loads Stripe and request receipt never renders a manage/cancel link.

- [ ] **Step 4: Run all quality gates**

Run: `pnpm build`
Run: `pnpm lint`
Run: `pnpm typecheck`
Run: `DATABASE_URL=postgresql://haip:haip@localhost:5432/haip_test REDIS_URL=redis://localhost:6379 CI=true pnpm test`
Expected: build/typecheck/tests succeed; lint has zero errors.

- [ ] **Step 5: Run React diagnostics**

Invoke the `react-doctor` skill against both `apps/dashboard` and `apps/booking`, address all actionable errors, then rerun their tests and typechecks.

- [ ] **Step 6: Sync published test counts**

Run: `pnpm readme:sync-tests`
Review only the generated README badge/count and `docs/test-stats.json` changes.

- [ ] **Step 7: Verify rollout guard manually**

With an existing/default property, confirm the widget still performs instant booking. With request mode enabled, confirm instant `POST /booking-engine/book` remains available only to the instant widget path and the request UI uses the dedicated request endpoint. Confirm switching back to instant preserves staff access to historical requests.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/booking-request/booking-request.e2e-spec.ts apps/booking/src/pages/RequestFlow.e2e.test.tsx README.md docs/test-stats.json docs/superpowers/specs/2026-08-24-booking-requests-design.md
git commit -m "test(booking-requests): verify the complete workflow"
```

---

## Final review checklist

- [ ] Re-read issue #332, its maintainer confirmation, the cited KB sections, the spec, and this plan; resolve any mismatch before opening a PR.
- [ ] Confirm all public endpoints are publishable-key scoped and cannot enumerate/read requests.
- [ ] Confirm every staff nested-resource query filters `propertyId` directly.
- [ ] Confirm request acceptance and payment retries cannot duplicate external or database side effects.
- [ ] Confirm no raw card data, client-trusted card metadata, application answers, consent text, or payment token appears in logs/webhooks.
- [ ] Confirm instant booking remains the default and passes its original tests.
- [ ] Confirm request mode is usable end-to-end before exposing its setting.
- [ ] Use `superpowers:verification-before-completion` before claiming completion.
- [ ] Use `superpowers:requesting-code-review` before proposing merge.
