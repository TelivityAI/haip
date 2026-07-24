import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  date,
  integer,
  boolean,
  numeric,
  pgEnum,
} from 'drizzle-orm/pg-core';
import { properties } from './property.js';
import { roomTypes } from './room.js';
import { ratePlans } from './rate-plan.js';
import { reservations } from './reservation.js';

export const turnawayTypeEnum = pgEnum('turnaway_type', ['denial', 'regret']);

export const turnawayReasonCodes = pgTable('turnaway_reason_codes', {
  id: uuid('id').primaryKey().defaultRandom(),
  propertyId: uuid('property_id').notNull().references(() => properties.id),
  code: varchar('code', { length: 40 }).notNull(),
  description: varchar('description', { length: 255 }).notNull(),
  type: turnawayTypeEnum('type').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const turnaways = pgTable('turnaways', {
  id: uuid('id').primaryKey().defaultRandom(),
  propertyId: uuid('property_id').notNull().references(() => properties.id),
  arrivalDate: date('arrival_date').notNull(),
  nights: integer('nights').notNull().default(1),
  roomsRequested: integer('rooms_requested').notNull().default(1),
  adults: integer('adults').notNull().default(1),
  children: integer('children').notNull().default(0),
  roomTypeId: uuid('room_type_id').references(() => roomTypes.id),
  ratePlanId: uuid('rate_plan_id').references(() => ratePlans.id),
  reasonCodeId: uuid('reason_code_id').references(() => turnawayReasonCodes.id),
  type: turnawayTypeEnum('type').notNull(),
  channel: varchar('channel', { length: 60 }),
  quotedRateAmount: numeric('quoted_rate_amount', { precision: 12, scale: 2 }),
  currencyCode: varchar('currency_code', { length: 3 }),
  comment: text('comment'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const waitlistEntryStatusEnum = pgEnum('waitlist_entry_status', [
  'active',
  'offered',
  'converted',
  'cancelled',
  'expired',
]);

export const waitlistEntries = pgTable('waitlist_entries', {
  id: uuid('id').primaryKey().defaultRandom(),
  propertyId: uuid('property_id').notNull().references(() => properties.id),
  status: waitlistEntryStatusEnum('status').notNull().default('active'),
  arrivalDate: date('arrival_date').notNull(),
  departureDate: date('departure_date').notNull(),
  roomsRequested: integer('rooms_requested').notNull().default(1),
  adults: integer('adults').notNull().default(1),
  children: integer('children').notNull().default(0),
  roomTypeId: uuid('room_type_id').references(() => roomTypes.id),
  ratePlanId: uuid('rate_plan_id').references(() => ratePlans.id),
  priority: integer('priority').notNull().default(0),
  guestName: varchar('guest_name', { length: 200 }),
  contactEmail: varchar('contact_email', { length: 255 }),
  contactPhone: varchar('contact_phone', { length: 50 }),
  notes: text('notes'),
  offerExpiresAt: timestamp('offer_expires_at', { withTimezone: true }),
  convertedReservationId: uuid('converted_reservation_id').references(() => reservations.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
