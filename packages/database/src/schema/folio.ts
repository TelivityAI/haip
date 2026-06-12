import { pgTable, uuid, varchar, text, boolean, timestamp, numeric, pgEnum, uniqueIndex } from 'drizzle-orm/pg-core';
import { properties } from './property.js';
import { reservations, bookings } from './reservation.js';
import { guests } from './guest.js';
import { houseAccounts } from './house-account.js';

/**
 * Folio types (KB 5.4):
 * Guest (individual room account), Master (group consolidation),
 * Split (divided charges), City Ledger (non-guest A/R)
 */
export const folioTypeEnum = pgEnum('folio_type', [
  'guest',        // Individual room folio
  'master',       // Consolidates multiple rooms (groups, conferences)
  'city_ledger',  // Non-guest A/R (corporate monthly billing)
]);

export const folioStatusEnum = pgEnum('folio_status', [
  'open',
  'settled',
  'closed',       // After night audit day close
]);

/**
 * Folios — billing entities (KB 5.4).
 * Each reservation has a main folio + optional additional folios.
 * Settlement: cash, card, city ledger transfer; balance must be zero at checkout.
 */
export const folios = pgTable('folios', {
  id: uuid('id').primaryKey().defaultRandom(),
  propertyId: uuid('property_id').notNull().references(() => properties.id),
  reservationId: uuid('reservation_id').references(() => reservations.id), // Null for city ledger
  bookingId: uuid('booking_id').references(() => bookings.id),
  guestId: uuid('guest_id').notNull().references(() => guests.id),

  folioNumber: varchar('folio_number', { length: 50 }).notNull(),
  type: folioTypeEnum('type').notNull().default('guest'),
  status: folioStatusEnum('status').notNull().default('open'),

  // Running balance
  totalCharges: numeric('total_charges', { precision: 12, scale: 2 }).notNull().default('0'),
  totalPayments: numeric('total_payments', { precision: 12, scale: 2 }).notNull().default('0'),
  balance: numeric('balance', { precision: 12, scale: 2 }).notNull().default('0'),
  currencyCode: varchar('currency_code', { length: 3 }).notNull(),

  // City ledger specific
  companyName: varchar('company_name', { length: 255 }),
  billingAddress: text('billing_address'),
  paymentTermsDays: varchar('payment_terms_days', { length: 10 }), // "NET30", "NET60"

  notes: text('notes'),

  settledAt: timestamp('settled_at', { withTimezone: true }),
  closedAt: timestamp('closed_at', { withTimezone: true }),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  uniqueFolioNumber: uniqueIndex('folios_property_folio_number_unique')
    .on(table.propertyId, table.folioNumber),
}));

/**
 * Charge types for folio line items.
 */
export const chargeTypeEnum = pgEnum('charge_type', [
  'room',           // Room tariff (posted during night audit)
  'tax',            // Tourist/occupancy/VAT tax
  'food_beverage',  // Restaurant, bar, room service
  'minibar',
  'phone',
  'laundry',
  'parking',
  'spa',
  'incidental',     // Other incidental charges
  'fee',            // Late checkout, no-show fee, cancellation fee
  'adjustment',     // Manual correction
  'package',        // Package component charge
]);

/**
 * Charges — line items on a folio (KB 5.4).
 * Room charges posted during night audit, others posted in real-time.
 */
export const charges = pgTable('charges', {
  id: uuid('id').primaryKey().defaultRandom(),
  propertyId: uuid('property_id').notNull().references(() => properties.id),
  // folioId is nullable: a charge belongs to EITHER a folio OR a house account
  // (KB 13 — house accounts reuse the charges ledger but have no folio).
  folioId: uuid('folio_id').references(() => folios.id),
  houseAccountId: uuid('house_account_id').references(() => houseAccounts.id),

  type: chargeTypeEnum('type').notNull(),
  description: varchar('description', { length: 255 }).notNull(),
  amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
  currencyCode: varchar('currency_code', { length: 3 }).notNull(),

  // Tax breakdown (posted separately per KB 5.10)
  taxAmount: numeric('tax_amount', { precision: 12, scale: 2 }).notNull().default('0'),
  taxRate: numeric('tax_rate', { precision: 5, scale: 4 }), // e.g., 0.0875 for 8.75%
  taxCode: varchar('tax_code', { length: 20 }), // "TOURIST_TAX", "VAT", "OCCUPANCY"

  // Reference
  serviceDate: timestamp('service_date', { withTimezone: true }).notNull(), // Date the charge applies to
  isReversal: boolean('is_reversal').notNull().default(false),
  originalChargeId: uuid('original_charge_id').references((): any => charges.id), // FK to self for reversals
  parentChargeId: uuid('parent_charge_id').references((): any => charges.id), // FK to self — tax charges linked to their parent charge

  // Night audit lock (KB 5.8: transactions locked after day close)
  isLocked: boolean('is_locked').notNull().default(false),
  lockedByAuditDate: timestamp('locked_by_audit_date', { mode: 'date' }),

  // Who posted it
  postedBy: uuid('posted_by'), // Staff user ID or "system" for night audit
  postedAt: timestamp('posted_at', { withTimezone: true }).notNull().defaultNow(),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Payment methods.
 */
export const paymentMethodEnum = pgEnum('payment_method', [
  'credit_card',
  'debit_card',
  'cash',
  'bank_transfer',
  'city_ledger',    // Transfer to A/R
  'vcc',            // Virtual Credit Card from OTA (KB 6.2)
  'other',
]);

export const paymentStatusEnum = pgEnum('payment_status', [
  'pending',
  'authorized',     // Pre-auth hold
  'captured',       // Payment captured
  'settled',        // Fully settled
  'refunded',
  'partially_refunded',
  'failed',
  'voided',
]);

/**
 * Payments — payment records linked to folios (KB 5.4, 6.2).
 * PCI compliant: only stores payment tokens, never raw card data.
 * Pre-auth at check-in, incremental during stay, final settlement at checkout.
 */
export const payments = pgTable('payments', {
  id: uuid('id').primaryKey().defaultRandom(),
  propertyId: uuid('property_id').notNull().references(() => properties.id),
  // folioId is nullable: a payment belongs to EITHER a folio OR a house account
  // (KB 13 — house accounts reuse the payments ledger but have no folio).
  folioId: uuid('folio_id').references(() => folios.id),
  houseAccountId: uuid('house_account_id').references(() => houseAccounts.id),

  method: paymentMethodEnum('method').notNull(),
  status: paymentStatusEnum('status').notNull().default('pending'),

  amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
  currencyCode: varchar('currency_code', { length: 3 }).notNull(),

  // Payment gateway (PCI — KB 5.10, 6.2)
  // NEVER store raw card data. Stripe/Adyen tokenization only.
  gatewayProvider: varchar('gateway_provider', { length: 20 }), // "stripe", "adyen"
  gatewayTransactionId: varchar('gateway_transaction_id', { length: 255 }),
  gatewayPaymentToken: varchar('gateway_payment_token', { length: 255 }), // Tokenized card reference
  cardLastFour: varchar('card_last_four', { length: 4 }),
  cardBrand: varchar('card_brand', { length: 20 }), // "visa", "mastercard", "amex"

  // Pre-authorization (KB 6.2: hold at check-in + 15-20% for incidentals)
  isPreAuthorization: boolean('is_pre_authorization').notNull().default(false),
  preAuthExpiresAt: timestamp('pre_auth_expires_at', { withTimezone: true }),

  // Refund reference
  originalPaymentId: uuid('original_payment_id').references((): any => payments.id), // FK to self for refunds

  notes: text('notes'),

  processedAt: timestamp('processed_at', { withTimezone: true }),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
