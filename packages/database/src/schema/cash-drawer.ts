import { pgTable, uuid, varchar, text, boolean, timestamp, numeric, pgEnum } from 'drizzle-orm/pg-core';
import { properties } from './property.js';

/**
 * Cash handling & cashiering (KB 12).
 *
 * A physical cash drawer tracks CASH-ONLY movements (card transactions settle via
 * the gateway and are excluded — KB 12.1). Cashiering is organized into sessions
 * tied to a cashier and a drawer (KB 12.2); each cash event is a movement (KB 12.3)
 * and at close the system computes expected balance and variance (KB 12.4).
 */
export const cashSessionStatusEnum = pgEnum('cash_session_status', [
  'open',
  'closed',
]);

export const cashMovementTypeEnum = pgEnum('cash_movement_type', [
  'payment',  // Cash payment received (in)
  'refund',   // Cash refund (out)
  'paid_out', // Petty-cash expense (out)
  'drop',     // Cash drop to safe (out)
]);

export const cashDrawers = pgTable('cash_drawers', {
  id: uuid('id').primaryKey().defaultRandom(),
  propertyId: uuid('property_id').notNull().references(() => properties.id),

  name: varchar('name', { length: 255 }).notNull(),
  startingFloat: numeric('starting_float', { precision: 12, scale: 2 }).notNull().default('0'),
  isActive: boolean('is_active').notNull().default(true),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const cashDrawerSessions = pgTable('cash_drawer_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  propertyId: uuid('property_id').notNull().references(() => properties.id),
  cashDrawerId: uuid('cash_drawer_id').notNull().references(() => cashDrawers.id),
  cashierUserId: uuid('cashier_user_id').notNull(),

  status: cashSessionStatusEnum('status').notNull().default('open'),
  openingFloat: numeric('opening_float', { precision: 12, scale: 2 }).notNull(),
  expectedBalance: numeric('expected_balance', { precision: 12, scale: 2 }), // Computed at close (KB 12.4)
  countedBalance: numeric('counted_balance', { precision: 12, scale: 2 }),   // Entered by cashier at close
  variance: numeric('variance', { precision: 12, scale: 2 }),                // counted − expected (KB 12.4)

  openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
  closedAt: timestamp('closed_at', { withTimezone: true }),
});

export const cashMovements = pgTable('cash_movements', {
  id: uuid('id').primaryKey().defaultRandom(),
  propertyId: uuid('property_id').notNull().references(() => properties.id),
  sessionId: uuid('session_id').notNull().references(() => cashDrawerSessions.id),

  type: cashMovementTypeEnum('type').notNull(),
  amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
  reservationId: uuid('reservation_id'), // Optional — movements need not be tied to a reservation (KB 12.3)
  note: text('note'),
  createdBy: uuid('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
