import { pgTable, uuid, varchar, text, boolean, timestamp, jsonb, integer, numeric, date, pgEnum } from 'drizzle-orm/pg-core';
import { properties } from './property.js';
import { roomTypes } from './room.js';
import { cancellationPolicies } from './cancellation-policy.js';

/**
 * Rate plan types (KB 5.3):
 * BAR, derived, negotiated, package, seasonal, day-of-week, LOS-based, occupancy-based
 */
export const ratePlanTypeEnum = pgEnum('rate_plan_type', [
  'bar',            // Best Available Rate (dynamic)
  'derived',        // % or fixed off another rate plan
  'negotiated',     // Corporate, government, group contracts
  'package',        // Room + services bundled
  'promotional',    // Time-limited offers
]);

/**
 * Rate Plans — pricing rules for room types (KB 5.3).
 * Revenue management + channel distribution is existential (build plan).
 */
export const ratePlans = pgTable('rate_plans', {
  id: uuid('id').primaryKey().defaultRandom(),
  propertyId: uuid('property_id').notNull().references(() => properties.id),
  roomTypeId: uuid('room_type_id').notNull().references(() => roomTypes.id),

  name: varchar('name', { length: 100 }).notNull(), // "Best Available Rate", "AAA Discount"
  code: varchar('code', { length: 20 }).notNull(), // "BAR1", "AAA", "CORP-ACME"
  description: text('description'),
  type: ratePlanTypeEnum('type').notNull(),

  // Pricing
  baseAmount: numeric('base_amount', { precision: 12, scale: 2 }).notNull(),
  currencyCode: varchar('currency_code', { length: 3 }).notNull(),

  // Derived rate config (type = 'derived')
  parentRatePlanId: uuid('parent_rate_plan_id'), // FK to self for derived rates
  derivedAdjustmentType: varchar('derived_adjustment_type', { length: 10 }), // "percentage" | "fixed"
  derivedAdjustmentValue: numeric('derived_adjustment_value', { precision: 8, scale: 2 }),

  // Tax handling
  isTaxInclusive: boolean('is_tax_inclusive').notNull().default(false),

  // Cancellation policy reference
  cancellationPolicyId: uuid('cancellation_policy_id').references(() => cancellationPolicies.id),

  /** Optional link for negotiated rates to a corporate/agent profile (KB 14.3). */
  groupProfileId: uuid('group_profile_id'),

  // Meal plan
  mealPlan: varchar('meal_plan', { length: 20 }), // "room_only", "breakfast", "half_board", "full_board", "all_inclusive"

  // Validity
  validFrom: date('valid_from'),
  validTo: date('valid_to'),
  isActive: boolean('is_active').notNull().default(true),

  // Channel distribution
  channelCodes: jsonb('channel_codes').$type<string[]>(), // Which channels this rate is distributed to

  /** LOS pricing tiers: minNights → percent or fixed amount off base (7+/14+/21+ pattern). */
  losAdjustments: jsonb('los_adjustments').$type<
    Array<{
      minNights: number;
      adjustmentType: 'percentage' | 'fixed';
      adjustmentValue: number;
    }>
  >(),

  /** Occupancy-based pricing bands: occupancyPctMin/Max → adjustment. */
  occupancyBands: jsonb('occupancy_bands').$type<
    Array<{
      occupancyPctMin: number;
      occupancyPctMax: number;
      adjustmentType: 'percentage' | 'fixed';
      adjustmentValue: number;
    }>
  >(),

  // Metadata
  sortOrder: integer('sort_order').notNull().default(0),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Rate Restrictions — stay controls per rate plan per date (KB 5.3).
 * MinLOS, MaxLOS, CTA, CTD — the core yield management levers.
 */
export const rateRestrictions = pgTable('rate_restrictions', {
  id: uuid('id').primaryKey().defaultRandom(),
  propertyId: uuid('property_id').notNull().references(() => properties.id),
  ratePlanId: uuid('rate_plan_id').notNull().references(() => ratePlans.id),

  // Date range this restriction applies to
  startDate: date('start_date').notNull(),
  endDate: date('end_date').notNull(),

  // Restrictions
  minLos: integer('min_los'), // Minimum length of stay (nights)
  maxLos: integer('max_los'), // Maximum length of stay
  closedToArrival: boolean('closed_to_arrival').notNull().default(false), // CTA
  closedToDeparture: boolean('closed_to_departure').notNull().default(false), // CTD
  isClosed: boolean('is_closed').notNull().default(false), // Rate not available at all

  // Day-of-week overrides (KB 5.3: weekend premium, weekday discount)
  dayOfWeekOverrides: jsonb('day_of_week_overrides').$type<Record<string, number>>(), // { "friday": 20, "saturday": 30 }

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
