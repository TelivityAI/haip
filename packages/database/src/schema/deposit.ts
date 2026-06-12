import { pgTable, uuid, varchar, text, boolean, timestamp, numeric, pgEnum } from 'drizzle-orm/pg-core';
import { properties } from './property.js';
import { reservations } from './reservation.js';
import { payments } from './folio.js';

/**
 * Deposit accounting (KB 10).
 *
 * An advance deposit is a LIABILITY, not revenue (KB 10.1). It is tracked in a
 * dedicated Deposit Ledger separate from the guest/current and A/R ledgers
 * (KB 10.2). The underlying money movement reuses the existing `payments` table;
 * this table classifies it as a liability and tracks recognition (KB 10.3).
 */
export const depositStatusEnum = pgEnum('deposit_status', [
  'held',       // Liability held — not yet recognized (KB 10.2)
  'applied',    // Applied to the reservation folio on check-in/checkout (KB 10.3)
  'refunded',   // Returned to original payment method — refundable path (KB 10.4)
  'forfeited',  // Retained as earned revenue — non-refundable cancel/no-show (KB 10.4)
]);

export const depositLedgerEntries = pgTable('deposit_ledger_entries', {
  id: uuid('id').primaryKey().defaultRandom(),
  propertyId: uuid('property_id').notNull().references(() => properties.id),
  reservationId: uuid('reservation_id').references(() => reservations.id), // Null until linked
  paymentId: uuid('payment_id').references(() => payments.id), // Underlying money movement

  amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
  currencyCode: varchar('currency_code', { length: 3 }).notNull(),
  status: depositStatusEnum('status').notNull().default('held'),
  isRefundable: boolean('is_refundable').notNull().default(true),

  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  recognizedAt: timestamp('recognized_at', { withTimezone: true }), // Set on apply/forfeit (KB 10.3)
  notes: text('notes'),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
