import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  integer,
  boolean,
  pgEnum,
} from 'drizzle-orm/pg-core';
import { organizations } from './organization.js';
import { properties } from './property.js';
import { guests } from './guest.js';
import { reservations } from './reservation.js';
import { folios } from './folio.js';

export const loyaltyPrograms = pgTable('loyalty_programs', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id),
  name: varchar('name', { length: 120 }).notNull(),
  pointsPerNight: integer('points_per_night').notNull().default(100),
  delayDays: integer('delay_days').notNull().default(3),
  earnEnabled: boolean('earn_enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const loyaltyAccounts = pgTable('loyalty_accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id),
  programId: uuid('program_id').notNull().references(() => loyaltyPrograms.id),
  guestId: uuid('guest_id').notNull().references(() => guests.id),
  availablePoints: integer('available_points').notNull().default(0),
  pendingPoints: integer('pending_points').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const loyaltyTxTypeEnum = pgEnum('loyalty_tx_type', [
  'earn',
  'burn',
  'adjust',
  'expire',
  'release',
]);

export const loyaltyTransactions = pgTable('loyalty_transactions', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id),
  propertyId: uuid('property_id').references(() => properties.id),
  accountId: uuid('account_id').notNull().references(() => loyaltyAccounts.id),
  type: loyaltyTxTypeEnum('type').notNull(),
  points: integer('points').notNull(),
  reservationId: uuid('reservation_id').references(() => reservations.id),
  folioId: uuid('folio_id').references(() => folios.id),
  note: text('note'),
  availableAt: timestamp('available_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
