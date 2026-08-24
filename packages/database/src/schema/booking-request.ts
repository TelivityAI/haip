import {
  date,
  integer,
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
import type { BookingFormQuestion } from './booking-engine.js';
import { payments, folios } from './folio.js';
import { properties } from './property.js';
import { ratePlans } from './rate-plan.js';
import { reservations } from './reservation.js';
import { roomTypes } from './room.js';

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
  'sent',
  'failed',
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
});

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
}));

export const bookingRequestPaymentResolutions = pgTable('booking_request_payment_resolutions', {
  id: uuid('id').primaryKey().defaultRandom(),
  propertyId: uuid('property_id').notNull().references(() => properties.id),
  bookingRequestId: uuid('booking_request_id').notNull().references(() => bookingRequests.id),
  paymentId: uuid('payment_id').notNull().references(() => payments.id),
  type: bookingRequestPaymentResolutionTypeEnum('type').notNull(),
  amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
  reason: text('reason'),
  resolvedBy: uuid('resolved_by'),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const bookingRequestEmailDeliveries = pgTable('booking_request_email_deliveries', {
  id: uuid('id').primaryKey().defaultRandom(),
  propertyId: uuid('property_id').notNull().references(() => properties.id),
  bookingRequestId: uuid('booking_request_id').notNull().references(() => bookingRequests.id),
  kind: bookingRequestEmailDeliveryKindEnum('kind').notNull(),
  status: bookingRequestEmailDeliveryStatusEnum('status').notNull().default('pending'),
  recipient: varchar('recipient', { length: 255 }).notNull(),
  subject: varchar('subject', { length: 500 }).notNull(),
  bodyText: text('body_text').notNull(),
  errorMessage: text('error_message'),
  attempts: integer('attempts').notNull().default(0),
  lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
