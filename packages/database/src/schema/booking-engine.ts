import { pgTable, uuid, varchar, boolean, timestamp, jsonb } from 'drizzle-orm/pg-core';
import { properties } from './property.js';

/**
 * Booking Engine — guest-facing direct (commission-free) booking.
 *
 * The public booking API (`/api/v1/booking-engine/*`) lets a hotel sell rooms
 * directly from its own website. It REUSES the existing availability / rate /
 * reservation / payment / deposit services — these tables only add the public
 * credential + per-property configuration.
 *
 * NB: reservations created here use the EXISTING `bookingSourceEnum` value
 * `'direct'` ("Hotel website / booking engine") with `channelCode='booking_engine'`.
 * Do NOT add a new source enum value — `'direct'` already models this.
 */

/**
 * Publishable booking keys.
 *
 * Mirrors `connect_credentials` (sha256-hashed, property-bound) but is a SEPARATE
 * table on purpose: a booking key is *publishable* — it ships in the hotel's
 * client-side HTML — so it is lower-trust and must never be interchangeable with a
 * server-side Connect API key. `BookingKeyGuard` restricts it to search / quote /
 * create-booking / read-or-cancel-own-confirmation; it can never enumerate data.
 */
export const bookingEngineCredentials = pgTable('booking_engine_credentials', {
  id: uuid('id').primaryKey().defaultRandom(),
  propertyId: uuid('property_id').notNull().references(() => properties.id),
  label: varchar('label', { length: 200 }).notNull(),
  // sha256(raw key), hex. Raw key (`pk_live_...`) shown to the operator ONCE.
  keyHash: varchar('key_hash', { length: 64 }).notNull().unique(),
  // Non-secret display prefix, e.g. "pk_live_AB" — safe to render in the dashboard.
  keyPrefix: varchar('key_prefix', { length: 16 }),
  isActive: boolean('is_active').notNull().default(true),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
});

/**
 * Per-property booking-engine configuration — exactly one row per property.
 */
export type DepositPolicy = {
  // none = pay at property; first_night = one night up front; percentage = % of total;
  // full = full prepayment. KB §10.5: booking-engine payments default to a "deposit".
  type: 'none' | 'first_night' | 'percentage' | 'full';
  percentage?: number; // only when type='percentage' (0–100)
  refundable: boolean; // KB §10.4
};

export const bookingEngineConfig = pgTable('booking_engine_config', {
  id: uuid('id').primaryKey().defaultRandom(),
  propertyId: uuid('property_id').notNull().unique().references(() => properties.id),
  isEnabled: boolean('is_enabled').notNull().default(false),
  displayName: varchar('display_name', { length: 200 }),
  logoMediaId: uuid('logo_media_id'),
  primaryColor: varchar('primary_color', { length: 9 }),
  accentColor: varchar('accent_color', { length: 9 }),
  // Allow-lists: only these room types / rate plans are publicly sellable. Empty
  // = nothing is sold (fail-closed) until the operator opts inventory in.
  sellableRoomTypeIds: jsonb('sellable_room_type_ids').$type<string[]>().notNull().default([]),
  sellableRatePlanIds: jsonb('sellable_rate_plan_ids').$type<string[]>().notNull().default([]),
  depositPolicy: jsonb('deposit_policy')
    .$type<DepositPolicy>()
    .notNull()
    .default({ type: 'first_night', refundable: true }),
  // Auto-confirm a paid booking instead of leaving it 'pending'. Conservative
  // default false (operations decision, not a KB rule).
  autoConfirm: boolean('auto_confirm').notNull().default(false),
  // Stripe PUBLISHABLE key (safe to expose to the widget). Secret key stays server-side.
  stripePublishableKey: varchar('stripe_publishable_key', { length: 255 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
