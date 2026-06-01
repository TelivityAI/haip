import { pgTable, uuid, varchar, text, boolean, timestamp, numeric, pgEnum } from 'drizzle-orm/pg-core';
import { properties } from './property.js';

/**
 * House Accounts & Non-Guest Sales (KB 13).
 *
 * A house account is a ledger for transactions NOT tied to any reservation,
 * room, or in-house guest — walk-in retail, bar/restaurant sales to non-guests,
 * internal/house use, or vendor accounts (KB 13.1). It behaves like a folio
 * (charges + payments + balance) but has NO reservation/guest link — that is the
 * defining trait (KB 13.1).
 *
 * MULTI-TENANCY EXCEPTION (CLAUDE.md): house accounts are property-scoped via
 * `property_id` and have NO guest link by design. All reads/updates/deletes are
 * scoped by `and(eq(id), eq(propertyId))` like any other property-scoped table;
 * there is simply no guest-reservation linkage to verify (unlike the `guests`
 * table whose rows are cross-property).
 */
export const houseAccountKindEnum = pgEnum('house_account_kind', [
  'retail',     // Walk-in retail / outlet sales
  'vendor',     // Recurring vendor account
  'internal',   // Internal / house use
  'other',
]);

export const houseAccountStatusEnum = pgEnum('house_account_status', [
  'open',
  'closed',     // Read-only; retained for audit (KB 13.2)
]);

export const houseAccounts = pgTable('house_accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  propertyId: uuid('property_id').notNull().references(() => properties.id),

  name: varchar('name', { length: 255 }).notNull(),
  kind: houseAccountKindEnum('kind').notNull().default('retail'),
  status: houseAccountStatusEnum('status').notNull().default('open'),

  // Running balance (mirrors folio totals; charges minus captured payments)
  balance: numeric('balance', { precision: 12, scale: 2 }).notNull().default('0'),
  totalCharges: numeric('total_charges', { precision: 12, scale: 2 }).notNull().default('0'),
  totalPayments: numeric('total_payments', { precision: 12, scale: 2 }).notNull().default('0'),
  currencyCode: varchar('currency_code', { length: 3 }).notNull(),

  notes: text('notes'),

  openedBy: uuid('opened_by'), // Staff user ID
  openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
  closedAt: timestamp('closed_at', { withTimezone: true }),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Products — retail / item catalog (KB 13.3).
 *
 * Selling a non-lodging item posts a charge to a house account; this catalog
 * holds item, category, price, and tax class. Property-scoped.
 */
export const products = pgTable('products', {
  id: uuid('id').primaryKey().defaultRandom(),
  propertyId: uuid('property_id').notNull().references(() => properties.id),

  category: varchar('category', { length: 100 }),
  name: varchar('name', { length: 255 }).notNull(),
  price: numeric('price', { precision: 12, scale: 2 }).notNull(),
  currencyCode: varchar('currency_code', { length: 3 }).notNull(),
  taxCode: varchar('tax_code', { length: 20 }),
  isActive: boolean('is_active').notNull().default(true),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
