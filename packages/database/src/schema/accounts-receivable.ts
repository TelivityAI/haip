import { pgTable, uuid, varchar, text, timestamp, numeric, pgEnum } from 'drizzle-orm/pg-core';
import { properties } from './property.js';
import { folios } from './folio.js';

/**
 * Accounts Receivable (A/R) — post-stay direct billing (KB 11).
 *
 * A/R is money owed to the property AFTER the guest departs, under a direct-bill
 * arrangement (KB 11.1). The existing `city_ledger` folio type is the substrate;
 * A/R adds named ledgers (KB 11.2) and a formal transfer workflow (KB 11.3-11.4).
 */
export const arLedgerStatusEnum = pgEnum('ar_ledger_status', [
  'open',
  'closed',  // Excluded from default views but retained for audit (KB 11.2)
]);

export const arTxnTypeEnum = pgEnum('ar_txn_type', [
  'transfer_in',      // Folio balance transferred into the ledger (KB 11.3)
  'payment',          // Payment recorded against the ledger (KB 11.5)
  'reverse_transfer', // Undo of a transfer (KB 11.4)
  'adjustment',       // Manual correction
]);

export const arLedgers = pgTable('ar_ledgers', {
  id: uuid('id').primaryKey().defaultRandom(),
  propertyId: uuid('property_id').notNull().references(() => properties.id),

  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  paymentTermsDays: varchar('payment_terms_days', { length: 10 }), // "NET30", "NET60"
  status: arLedgerStatusEnum('status').notNull().default('open'),
  balance: numeric('balance', { precision: 12, scale: 2 }).notNull().default('0'),
  currencyCode: varchar('currency_code', { length: 3 }).notNull(),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const arTransactions = pgTable('ar_transactions', {
  id: uuid('id').primaryKey().defaultRandom(),
  propertyId: uuid('property_id').notNull().references(() => properties.id),
  arLedgerId: uuid('ar_ledger_id').notNull().references(() => arLedgers.id),

  type: arTxnTypeEnum('type').notNull(),
  amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
  currencyCode: varchar('currency_code', { length: 3 }).notNull(),

  sourceFolioId: uuid('source_folio_id').references(() => folios.id), // Folio the balance came from
  reversedById: uuid('reversed_by_id').references((): any => arTransactions.id), // Links a transfer to its reversal (KB 11.4)

  note: text('note'),
  createdBy: uuid('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
