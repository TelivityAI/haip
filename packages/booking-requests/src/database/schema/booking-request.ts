import {
  check,
  date,
  foreignKey,
  integer,
  index,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import {
  folios,
  payments,
  properties,
  ratePlans,
  reservations,
  roomTypes,
  type AcceptedPricingSnapshot,
} from '@telivityhaip/database';
import type { BookingFormQuestion } from '@telivityhaip/database';

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

export const bookingRequestInstallmentMilestoneEnum = pgEnum('booking_request_installment_milestone', [
  'date',
  'arrival',
  'checkout',
  'manual',
]);

export const bookingRequestInstallmentStatusEnum = pgEnum('booking_request_installment_status', [
  'unpaid',
  'partial',
  'paid',
]);

export const bookingRequestPaymentResolutionTypeEnum = pgEnum('booking_request_payment_resolution_type', [
  'refund',
  'external_return',
  'retained',
]);

export const bookingRequestEmailDeliveryKindEnum = pgEnum('booking_request_email_delivery_kind', [
  'receipt',
  'accepted',
  'denied',
  'payment',
  'refund',
  'failure',
]);

export const bookingRequestEmailDeliveryStatusEnum = pgEnum('booking_request_email_delivery_status', [
  'pending',
  'processing',
  'sent',
  'failed',
]);

export const bookingRequests = pgTable('booking_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  propertyId: uuid('property_id').notNull().references(() => properties.id),
  submissionIdempotencyKey: varchar('submission_idempotency_key', { length: 200 }).notNull(),
  submissionFingerprint: varchar('submission_fingerprint', { length: 64 }).notNull(),
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
  submittedTotal: numeric('submitted_total', { precision: 12, scale: 2 }).notNull(),
  currentQuoteSnapshot: jsonb('current_quote_snapshot'),
  currencyCode: varchar('currency_code', { length: 3 }).notNull(),
  setupIntentId: varchar('setup_intent_id', { length: 255 }),
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
  propertySubmissionKeyUnique:
    uniqueIndex('booking_requests_property_submission_key_unique')
      .on(table.propertyId, table.submissionIdempotencyKey),
  setupIntentUnique: uniqueIndex('booking_requests_setup_intent_unique')
    .on(table.setupIntentId),
  acceptedReservationUnique: uniqueIndex('booking_requests_accepted_reservation_unique')
    .on(table.acceptedReservationId),
  propertyIdUnique: uniqueIndex('booking_requests_property_id_unique')
    .on(table.propertyId, table.id),
  propertySubmittedTotal: index('booking_requests_property_submitted_total_idx')
    .on(table.propertyId, table.submittedTotal, table.id),
}));

/**
 * Durable, replayable consequences emitted from Booking Request state changes.
 * Kinds are strings rather than a database enum so later receipt/decision/payment
 * consequences can extend this outbox without another enum migration.
 */
export type BookingRequestConsequenceKind =
  | 'created_event'
  | 'accepted_event'
  | 'denied_event'
  | 'reservation_created_event'
  | 'folio_created_event'
  | `payment_received:${string}`
  | `payment_failed:${string}`
  | `payment_refunded:${string}`
  | `external_returned:${string}`
  | `payment_retained:${string}`
  | `amend:${string}`
  | `service:${string}`;
export type BookingRequestConsequenceStatus = 'pending' | 'processing' | 'completed';

export const bookingRequestConsequences = pgTable('booking_request_consequences', {
  id: uuid('id').primaryKey().defaultRandom(),
  propertyId: uuid('property_id').notNull().references(() => properties.id),
  bookingRequestId: uuid('booking_request_id').notNull().references(() => bookingRequests.id),
  kind: varchar('kind', { length: 50 }).$type<BookingRequestConsequenceKind>().notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
  status: varchar('status', { length: 20 })
    .$type<BookingRequestConsequenceStatus>()
    .notNull()
    .default('pending'),
  attempts: integer('attempts').notNull().default(0),
  claimedAt: timestamp('claimed_at', { withTimezone: true }),
  lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
  lastError: text('last_error'),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  propertyRequestKindUnique:
    uniqueIndex('booking_request_consequences_property_request_kind_unique')
      .on(table.propertyId, table.bookingRequestId, table.kind),
  requestOwnership: foreignKey({
    name: 'booking_request_consequences_request_fkey',
    columns: [table.propertyId, table.bookingRequestId],
    foreignColumns: [bookingRequests.propertyId, bookingRequests.id],
  }),
}));

/**
 * Durable idempotency and audit boundary for operational stay amendments.
 * The Booking Request deal remains immutable; these rows capture successive
 * reservation/folio states chosen by staff.
 */
export const bookingRequestStayAmendments = pgTable('booking_request_stay_amendments', {
  id: uuid('id').primaryKey().defaultRandom(),
  propertyId: uuid('property_id').notNull().references(() => properties.id),
  bookingRequestId: uuid('booking_request_id').notNull().references(() => bookingRequests.id),
  reservationId: uuid('reservation_id').notNull().references(() => reservations.id),
  folioId: uuid('folio_id').notNull().references(() => folios.id),
  idempotencyKey: varchar('idempotency_key', { length: 200 }).notNull(),
  operationFingerprint: varchar('operation_fingerprint', { length: 64 }).notNull(),
  previewToken: varchar('preview_token', { length: 67 }).notNull(),
  priceSource: varchar('price_source', { length: 10 })
    .$type<'prior' | 'current' | 'custom'>()
    .notNull(),
  previousArrivalDate: date('previous_arrival_date').notNull(),
  previousDepartureDate: date('previous_departure_date').notNull(),
  newArrivalDate: date('new_arrival_date').notNull(),
  newDepartureDate: date('new_departure_date').notNull(),
  previousTotalAmount: numeric('previous_total_amount', { precision: 12, scale: 2 }).notNull(),
  newTotalAmount: numeric('new_total_amount', { precision: 12, scale: 2 }).notNull(),
  currencyCode: varchar('currency_code', { length: 3 }).notNull(),
  reason: text('reason'),
  previousPricingSnapshot: jsonb('previous_pricing_snapshot').$type<AcceptedPricingSnapshot>().notNull(),
  newPricingSnapshot: jsonb('new_pricing_snapshot').$type<AcceptedPricingSnapshot>().notNull(),
  actorUserId: uuid('actor_user_id'),
  actorEmail: varchar('actor_email', { length: 255 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  propertyIdempotencyUnique:
    uniqueIndex('booking_request_stay_amendments_property_idempotency_unique')
      .on(table.propertyId, table.idempotencyKey),
  propertyRequestFingerprintUnique:
    uniqueIndex('br_stay_amendments_property_request_fingerprint_unique')
      .on(table.propertyId, table.bookingRequestId, table.operationFingerprint),
  requestOwnership: foreignKey({
    name: 'booking_request_stay_amendments_request_fkey',
    columns: [table.propertyId, table.bookingRequestId],
    foreignColumns: [bookingRequests.propertyId, bookingRequests.id],
  }),
  reservationOwnership: foreignKey({
    name: 'booking_request_stay_amendments_reservation_fkey',
    columns: [table.propertyId, table.reservationId],
    foreignColumns: [reservations.propertyId, reservations.id],
  }),
  folioOwnership: foreignKey({
    name: 'booking_request_stay_amendments_folio_fkey',
    columns: [table.propertyId, table.folioId],
    foreignColumns: [folios.propertyId, folios.id],
  }),
}));

export const bookingRequestInstallments = pgTable('booking_request_installments', {
  id: uuid('id').primaryKey().defaultRandom(),
  propertyId: uuid('property_id').notNull().references(() => properties.id),
  bookingRequestId: uuid('booking_request_id').notNull().references(() => bookingRequests.id),
  label: varchar('label', { length: 200 }).notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  fixedAmount: numeric('fixed_amount', { precision: 12, scale: 2 }),
  percentage: numeric('percentage', { precision: 5, scale: 2 }),
  resolvedAmount: numeric('resolved_amount', { precision: 12, scale: 2 }),
  dueMilestone: bookingRequestInstallmentMilestoneEnum('due_milestone').notNull().default('manual'),
  dueDate: date('due_date'),
  allocatedAmount: numeric('allocated_amount', { precision: 12, scale: 2 }).notNull().default('0'),
  status: bookingRequestInstallmentStatusEnum('status').notNull().default('unpaid'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  propertyRequestIdUnique: uniqueIndex('booking_request_installments_property_request_id_unique')
    .on(table.propertyId, table.bookingRequestId, table.id),
  requestOwnership: foreignKey({
    name: 'booking_request_installments_request_fkey',
    columns: [table.propertyId, table.bookingRequestId],
    foreignColumns: [bookingRequests.propertyId, bookingRequests.id],
  }),
  amountKindCheck: check(
    'booking_request_installments_amount_kind_check',
    sql`(
      (${table.fixedAmount} is not null and ${table.fixedAmount} > 0 and ${table.percentage} is null)
      or
      (${table.fixedAmount} is null and ${table.percentage} > 0 and ${table.percentage} <= 100)
    ) and ${table.resolvedAmount} is not null and ${table.resolvedAmount} > 0`,
  ),
  milestoneDateCheck: check(
    'booking_request_installments_milestone_date_check',
    sql`(
      (${table.dueMilestone} = 'date' and ${table.dueDate} is not null)
      or
      (${table.dueMilestone} <> 'date' and ${table.dueDate} is null)
    )`,
  ),
  allocatedNonnegativeCheck: check(
    'booking_request_installments_allocated_nonnegative_check',
    sql`${table.allocatedAmount} >= 0 and ${table.allocatedAmount} <= ${table.resolvedAmount}`,
  ),
}));

export const bookingRequestPaymentAllocations = pgTable('booking_request_payment_allocations', {
  id: uuid('id').primaryKey().defaultRandom(),
  propertyId: uuid('property_id').notNull().references(() => properties.id),
  bookingRequestId: uuid('booking_request_id').notNull().references(() => bookingRequests.id),
  paymentId: uuid('payment_id').notNull().references(() => payments.id),
  installmentId: uuid('installment_id').notNull().references(() => bookingRequestInstallments.id),
  amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  paymentInstallmentUnique: uniqueIndex('booking_request_payment_allocations_payment_installment_unique')
    .on(table.paymentId, table.installmentId),
  requestOwnership: foreignKey({
    name: 'booking_request_payment_allocations_request_fkey',
    columns: [table.propertyId, table.bookingRequestId],
    foreignColumns: [bookingRequests.propertyId, bookingRequests.id],
  }),
  paymentOwnership: foreignKey({
    name: 'booking_request_payment_allocations_payment_fkey',
    columns: [table.propertyId, table.bookingRequestId, table.paymentId],
    foreignColumns: [payments.propertyId, payments.bookingRequestId, payments.id],
  }),
  installmentOwnership: foreignKey({
    name: 'booking_request_payment_allocations_installment_fkey',
    columns: [table.propertyId, table.bookingRequestId, table.installmentId],
    foreignColumns: [
      bookingRequestInstallments.propertyId,
      bookingRequestInstallments.bookingRequestId,
      bookingRequestInstallments.id,
    ],
  }),
  positiveCheck: check(
    'booking_request_payment_allocations_positive_check',
    sql`${table.amount} > 0`,
  ),
}));

export const bookingRequestPaymentResolutions = pgTable('booking_request_payment_resolutions', {
  id: uuid('id').primaryKey().defaultRandom(),
  propertyId: uuid('property_id').notNull().references(() => properties.id),
  bookingRequestId: uuid('booking_request_id').notNull().references(() => bookingRequests.id),
  paymentId: uuid('payment_id').notNull().references(() => payments.id),
  type: bookingRequestPaymentResolutionTypeEnum('type').notNull(),
  status: varchar('status', { length: 20 }).notNull().default('completed'),
  amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
  idempotencyKey: varchar('idempotency_key', { length: 255 }),
  operationFingerprint: varchar('operation_fingerprint', { length: 64 }),
  providerTransactionId: varchar('provider_transaction_id', { length: 255 }),
  providerStatus: varchar('provider_status', { length: 40 }),
  movementId: uuid('movement_id').references(() => payments.id),
  reason: text('reason'),
  attempts: integer('attempts').notNull().default(0),
  lastError: text('last_error'),
  resolvedBy: uuid('resolved_by'),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  propertyIdempotencyKeyUnique:
    uniqueIndex('booking_request_payment_resolutions_property_idempotency_unique')
      .on(table.propertyId, table.idempotencyKey),
  propertyProviderTransactionUnique:
    uniqueIndex('br_payment_resolutions_property_provider_tx_unique')
      .on(table.propertyId, table.providerTransactionId),
  requestOwnership: foreignKey({
    name: 'booking_request_payment_resolutions_request_fkey',
    columns: [table.propertyId, table.bookingRequestId],
    foreignColumns: [bookingRequests.propertyId, bookingRequests.id],
  }),
  paymentOwnership: foreignKey({
    name: 'booking_request_payment_resolutions_payment_fkey',
    columns: [table.propertyId, table.bookingRequestId, table.paymentId],
    foreignColumns: [payments.propertyId, payments.bookingRequestId, payments.id],
  }),
  parentMovementOwnership: foreignKey({
    name: 'booking_request_payment_resolutions_parent_movement_fkey',
    columns: [table.propertyId, table.bookingRequestId, table.paymentId, table.movementId],
    foreignColumns: [
      payments.propertyId,
      payments.bookingRequestId,
      payments.originalPaymentId,
      payments.id,
    ],
  }),
  positiveCheck: check(
    'booking_request_payment_resolutions_positive_check',
    sql`${table.amount} > 0`,
  ),
  statusCheck: check(
    'booking_request_payment_resolutions_status_check',
    sql`${table.status} in ('pending', 'completed', 'failed')`,
  ),
  retainedReasonCheck: check(
    'booking_request_payment_resolutions_retained_reason_check',
    sql`${table.type} <> 'retained' or (${table.reason} is not null and length(trim(${table.reason})) > 0)`,
  ),
  lifecycleCheck: check(
    'booking_request_payment_resolutions_lifecycle_check',
    sql`(
      (${table.status} = 'pending' and ${table.type} = 'refund'
        and ${table.idempotencyKey} is not null and ${table.operationFingerprint} is not null
        and ${table.resolvedAt} is null and ${table.movementId} is null)
      or
      (${table.status} = 'failed' and ${table.type} = 'refund'
        and ${table.idempotencyKey} is not null and ${table.operationFingerprint} is not null
        and ${table.resolvedAt} is not null and ${table.movementId} is null)
      or
      (${table.status} = 'completed' and ${table.resolvedAt} is not null and (
        (${table.type} in ('refund', 'external_return') and ${table.movementId} is not null)
        or
        (${table.type} = 'retained' and ${table.movementId} is null)
      ))
    )`,
  ),
}));

export const bookingRequestEmailDeliveries = pgTable('booking_request_email_deliveries', {
  id: uuid('id').primaryKey().defaultRandom(),
  propertyId: uuid('property_id').notNull().references(() => properties.id),
  bookingRequestId: uuid('booking_request_id').notNull().references(() => bookingRequests.id),
  logicalKey: varchar('logical_key', { length: 200 }).notNull(),
  kind: bookingRequestEmailDeliveryKindEnum('kind').notNull(),
  status: bookingRequestEmailDeliveryStatusEnum('status').notNull().default('pending'),
  recipient: varchar('recipient', { length: 255 }).notNull(),
  subject: varchar('subject', { length: 500 }).notNull(),
  bodyText: text('body_text').notNull(),
  errorMessage: text('error_message'),
  attempts: integer('attempts').notNull().default(0),
  automaticAttempts: integer('automatic_attempts').notNull().default(0),
  claimedAt: timestamp('claimed_at', { withTimezone: true }),
  nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }),
  lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
  providerMessageId: varchar('provider_message_id', { length: 500 }),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  logicalKeyUnique: uniqueIndex('booking_request_email_deliveries_logical_key_unique')
    .on(table.propertyId, table.bookingRequestId, table.logicalKey),
  recoveryIndex: index('booking_request_email_deliveries_recovery_idx')
    .on(table.status, table.nextAttemptAt, table.claimedAt)
    .where(sql`${table.status} IN ('pending', 'processing')`),
  requestOwnership: foreignKey({
    name: 'booking_request_email_deliveries_request_fkey',
    columns: [table.propertyId, table.bookingRequestId],
    foreignColumns: [bookingRequests.propertyId, bookingRequests.id],
  }),
}));
