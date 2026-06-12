import { pgTable, uuid, varchar, boolean, timestamp, pgEnum } from 'drizzle-orm/pg-core';
import { properties } from './property.js';

/**
 * Custom accounting / GL codes (KB 5).
 *
 * User-defined transaction and general-ledger codes that can be surfaced on
 * transaction-detail report output. No behavior change to posting.
 */
export const accountingCodeKindEnum = pgEnum('accounting_code_kind', [
  'transaction', // Transaction code
  'gl',          // General-ledger code
]);

export const accountingCodes = pgTable('accounting_codes', {
  id: uuid('id').primaryKey().defaultRandom(),
  propertyId: uuid('property_id').notNull().references(() => properties.id),

  kind: accountingCodeKindEnum('kind').notNull(),
  code: varchar('code', { length: 50 }).notNull(),
  label: varchar('label', { length: 255 }).notNull(),
  appliesTo: varchar('applies_to', { length: 50 }), // e.g. charge_type / payment_method
  archived: boolean('archived').notNull().default(false),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
