import { pgTable, uuid, varchar, text, boolean, timestamp, jsonb, integer, date, pgEnum } from 'drizzle-orm/pg-core';
import { properties } from './property.js';

/**
 * Room status state machine (from KB 5.2):
 * Vacant Clean → Vacant Dirty → Clean → Inspected → Guest Ready
 * Also: Occupied, Out of Order (OOO), Out of Service (OOS)
 */

export const hkOccupancyEnum = pgEnum('hk_occupancy', ['unknown', 'vacant', 'occupied']);

export const roomDiscrepancyKindEnum = pgEnum('room_discrepancy_kind', [
  'fo_occupied_hk_vacant',
  'fo_vacant_hk_occupied',
  'person_count_mismatch',
  'occupied_without_reservation',
  'vacant_with_in_house_reservation',
]);

export const roomDiscrepancyStatusEnum = pgEnum('room_discrepancy_status', [
  'open',
  'resolved',
  'dismissed',
]);

export const roomStatusEnum = pgEnum('room_status', [
  'vacant_clean',
  'vacant_dirty',
  'clean',
  'inspected',
  'guest_ready',
  'occupied',
  'out_of_order',
  'out_of_service',
]);

/**
 * Room Types — max 5 per property recommended (KB 5.2).
 * Standard = 50-70% of inventory, Deluxe = 15-25% premium.
 * Names must match across PMS, OTAs, website, booking engine.
 */
export const roomTypes = pgTable('room_types', {
  id: uuid('id').primaryKey().defaultRandom(),
  propertyId: uuid('property_id').notNull().references(() => properties.id),
  name: varchar('name', { length: 100 }).notNull(), // "Standard King", "Deluxe Double", "Suite"
  code: varchar('code', { length: 20 }).notNull(), // "STD-K", "DLX-D", "STE"
  description: text('description'),

  // Capacity
  maxOccupancy: integer('max_occupancy').notNull(),
  defaultOccupancy: integer('default_occupancy').notNull(),

  // Physical
  bedType: varchar('bed_type', { length: 50 }), // "king", "queen", "double", "twin", "sofa"
  bedCount: integer('bed_count').notNull().default(1),
  squareMeters: integer('square_meters'),
  floor: varchar('floor', { length: 10 }),

  // Features
  isAccessible: boolean('is_accessible').notNull().default(false), // ADA rooms dispersed across categories
  amenities: jsonb('amenities').$type<string[]>(), // ["wifi", "minibar", "balcony", "safe"]

  // Pricing reference (base rate defined here, actuals in rate_plans)
  sortOrder: integer('sort_order').notNull().default(0),

  // Status
  isActive: boolean('is_active').notNull().default(true),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Rooms — individual sellable units.
 * Every room belongs to a property and a room type.
 */
export const rooms = pgTable('rooms', {
  id: uuid('id').primaryKey().defaultRandom(),
  propertyId: uuid('property_id').notNull().references(() => properties.id),
  roomTypeId: uuid('room_type_id').notNull().references(() => roomTypes.id),

  number: varchar('number', { length: 20 }).notNull(), // "101", "PH-1", "A-204"
  floor: varchar('floor', { length: 10 }),
  building: varchar('building', { length: 50 }), // For multi-building properties

  // Status (state machine)
  status: roomStatusEnum('status').notNull().default('vacant_clean'),

  // HK observed occupancy (orthogonal to FO / cleanliness status)
  hkOccupancy: hkOccupancyEnum('hk_occupancy').notNull().default('unknown'),
  hkObservedPersons: integer('hk_observed_persons'),
  hkObservedAt: timestamp('hk_observed_at', { withTimezone: true }),
  hkObservedBy: uuid('hk_observed_by'),

  // Features (override room type defaults)
  isAccessible: boolean('is_accessible').notNull().default(false),
  isConnecting: boolean('is_connecting').notNull().default(false),
  connectingRoomId: uuid('connecting_room_id').references((): any => rooms.id), // Self-referencing FK
  amenities: jsonb('amenities').$type<string[]>(), // Room-specific overrides

  // Maintenance
  maintenanceNotes: text('maintenance_notes'),
  lastInspectedAt: timestamp('last_inspected_at', { withTimezone: true }),

  // Status
  isActive: boolean('is_active').notNull().default(true),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});


export const roomDiscrepancyCases = pgTable('room_discrepancy_cases', {
  id: uuid('id').primaryKey().defaultRandom(),
  propertyId: uuid('property_id').notNull().references(() => properties.id),
  roomId: uuid('room_id').notNull().references(() => rooms.id),
  businessDate: date('business_date').notNull(),
  kind: roomDiscrepancyKindEnum('kind').notNull(),
  status: roomDiscrepancyStatusEnum('status').notNull().default('open'),
  reservationId: uuid('reservation_id'),
  resolutionAction: varchar('resolution_action', { length: 80 }),
  resolutionNote: text('resolution_note'),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  resolvedBy: uuid('resolved_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
