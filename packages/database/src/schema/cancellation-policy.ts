import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  timestamp,
  integer,
  numeric,
  pgEnum,
} from 'drizzle-orm/pg-core';
import { properties } from './property.js';

/**
 * Cancellation / deposit outcome policy (rate-plan linked).
 *
 * Collection amount at book stays on booking-engine `depositPolicy`.
 * This table drives cancel / no-show outcomes: free-cancel window, penalty,
 * and deposit refund vs forfeit (KB §10.4).
 */
export const cancellationPenaltyTypeEnum = pgEnum('cancellation_penalty_type', [
  'none',
  'first_night',
  'percentage',
  'full',
]);

export const cancellationDepositHandlingEnum = pgEnum('cancellation_deposit_handling', [
  'refund_if_refundable',
  'always_forfeit',
  'always_refund',
]);

export const cancellationPolicies = pgTable('cancellation_policies', {
  id: uuid('id').primaryKey().defaultRandom(),
  propertyId: uuid('property_id')
    .notNull()
    .references(() => properties.id),

  name: varchar('name', { length: 100 }).notNull(),
  code: varchar('code', { length: 20 }).notNull(),
  description: text('description'),

  /** Hours before arrival when cancel is still free of penalty. */
  freeCancelHoursBeforeArrival: integer('free_cancel_hours_before_arrival').notNull().default(24),

  penaltyType: cancellationPenaltyTypeEnum('penalty_type').notNull().default('first_night'),
  /** Only when penaltyType = percentage (0–100). */
  penaltyPercentage: numeric('penalty_percentage', { precision: 5, scale: 2 }),

  depositHandling: cancellationDepositHandlingEnum('deposit_handling')
    .notNull()
    .default('refund_if_refundable'),

  isActive: boolean('is_active').notNull().default(true),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
