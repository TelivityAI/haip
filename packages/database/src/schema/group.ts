import { pgTable, uuid, varchar, text, boolean, integer, date, timestamp, pgEnum } from 'drizzle-orm/pg-core';
import { properties } from './property.js';
import { folios } from './folio.js';
import { ratePlans } from './rate-plan.js';
import { roomTypes } from './room.js';
import { reservations } from './reservation.js';

/**
 * Group business type (KB 14.3).
 */
export const groupTypeEnum = pgEnum('group_type', [
  'corporate',
  'travel_agent',
  'wholesale',
  'event',
  'other',
]);

/**
 * Allotment block lifecycle (KB 14.4).
 */
export const blockStatusEnum = pgEnum('block_status', [
  'tentative',
  'definite',
  'released',
  'cancelled',
]);

/**
 * Rooming list entry processing status (KB 14.6).
 */
export const roomingListEntryStatusEnum = pgEnum('rooming_list_entry_status', [
  'pending',
  'created',
  'error',
]);

/**
 * Group profiles — master record for group/corporate/agent business (KB 14.3).
 * Links member reservations, contacts, and allotment blocks; may own a master folio.
 */
export const groupProfiles = pgTable('group_profiles', {
  id: uuid('id').primaryKey().defaultRandom(),
  propertyId: uuid('property_id').notNull().references(() => properties.id),

  name: varchar('name', { length: 255 }).notNull(),
  type: groupTypeEnum('type').notNull().default('corporate'),

  contactName: varchar('contact_name', { length: 255 }),
  contactEmail: varchar('contact_email', { length: 255 }),
  contactPhone: varchar('contact_phone', { length: 30 }),

  // Group/master folio for consolidated billing (KB 14.7)
  masterFolioId: uuid('master_folio_id').references(() => folios.id),

  notes: text('notes'),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Allotment blocks — a quantity of rooms held for a group at agreed rates
 * over a date range, by room type (KB 14.4).
 */
export const allotmentBlocks = pgTable('allotment_blocks', {
  id: uuid('id').primaryKey().defaultRandom(),
  propertyId: uuid('property_id').notNull().references(() => properties.id),
  groupProfileId: uuid('group_profile_id').notNull().references(() => groupProfiles.id),

  name: varchar('name', { length: 255 }).notNull(),
  ratePlanId: uuid('rate_plan_id').references(() => ratePlans.id),

  startDate: date('start_date').notNull(),
  endDate: date('end_date').notNull(),

  // Cutoff: deadline after which un-picked-up rooms are auto-released (KB 14.4)
  cutoffDate: date('cutoff_date'),
  autoRelease: boolean('auto_release').notNull().default(true),

  // Optional shoulder nights around the core block (KB 14.4)
  shoulderStart: date('shoulder_start'),
  shoulderEnd: date('shoulder_end'),

  minLos: integer('min_los'),
  maxLos: integer('max_los'),

  // Shareable group code for self-booking (KB 14.4)
  groupCode: varchar('group_code', { length: 50 }),

  status: blockStatusEnum('status').notNull().default('tentative'),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Allotment block inventory — per date/room-type rooms allotted vs picked up
 * (pickup is tracked here — KB 14.5).
 */
export const allotmentBlockInventory = pgTable('allotment_block_inventory', {
  id: uuid('id').primaryKey().defaultRandom(),
  propertyId: uuid('property_id').notNull().references(() => properties.id),
  allotmentBlockId: uuid('allotment_block_id').notNull().references(() => allotmentBlocks.id),

  stayDate: date('stay_date').notNull(),
  roomTypeId: uuid('room_type_id').notNull().references(() => roomTypes.id),

  roomsAllotted: integer('rooms_allotted').notNull().default(0),
  roomsPickedUp: integer('rooms_picked_up').notNull().default(0),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Rooming list entries — the group's roster of guest names assigned to block
 * rooms; ingested to create/assign member reservations (KB 14.6).
 */
export const roomingListEntries = pgTable('rooming_list_entries', {
  id: uuid('id').primaryKey().defaultRandom(),
  propertyId: uuid('property_id').notNull().references(() => properties.id),
  allotmentBlockId: uuid('allotment_block_id').notNull().references(() => allotmentBlocks.id),

  guestName: varchar('guest_name', { length: 255 }).notNull(),
  arrival: date('arrival'),
  departure: date('departure'),
  roomTypeId: uuid('room_type_id').references(() => roomTypes.id),

  // Null until the member reservation is created (KB 14.6)
  reservationId: uuid('reservation_id').references(() => reservations.id),
  status: roomingListEntryStatusEnum('status').notNull().default('pending'),
  errorNote: text('error_note'),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
