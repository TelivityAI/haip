import { pgTable, uuid, varchar, timestamp, numeric, uniqueIndex } from 'drizzle-orm/pg-core';
import { properties } from './property.js';
import { charges } from './folio.js';

/** Idempotency ledger for PBX/minibar/webhook folio posts. */
export const folioInboundPosts = pgTable(
  'folio_inbound_posts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    propertyId: uuid('property_id').notNull().references(() => properties.id),
    vendorTxnId: varchar('vendor_txn_id', { length: 120 }).notNull(),
    chargeId: uuid('charge_id').references(() => charges.id),
    roomNumber: varchar('room_number', { length: 20 }).notNull(),
    chargeType: varchar('charge_type', { length: 40 }).notNull(),
    amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
    currencyCode: varchar('currency_code', { length: 3 }).notNull().default('USD'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniq: uniqueIndex('folio_inbound_posts_property_vendor_unique').on(t.propertyId, t.vendorTxnId),
  }),
);
