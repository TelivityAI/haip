import { pgTable, uuid, varchar, text, timestamp, pgEnum, integer } from 'drizzle-orm/pg-core';
import { properties } from './property.js';
import { rooms } from './room.js';
import { reservations } from './reservation.js';
import { guests } from './guest.js';
import { housekeepingTasks } from './housekeeping.js';

/** Lost-and-found item lifecycle: held in storage, returned to guest, or disposed. */
export const lostAndFoundCategoryEnum = pgEnum('lost_and_found_category', [
  'general',
  'baggage',
  'parcel',
  'valet',
]);

export const lostAndFoundStatusEnum = pgEnum('lost_and_found_status', [
  'held',
  'returned',
  'disposed',
]);

/**
 * Items found on property — bagged, tagged, and held for a retention period
 * before disposal.
 */
export const lostAndFoundItems = pgTable('lost_and_found_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  propertyId: uuid('property_id').notNull().references(() => properties.id),
  roomId: uuid('room_id').references(() => rooms.id),
  reservationId: uuid('reservation_id').references(() => reservations.id),
  guestId: uuid('guest_id').references(() => guests.id),
  category: lostAndFoundCategoryEnum('category').notNull().default('general'),
  description: text('description').notNull(),
  tagCode: varchar('tag_code', { length: 50 }).notNull(),
  status: lostAndFoundStatusEnum('status').notNull().default('held'),
  foundAt: timestamp('found_at', { withTimezone: true }).notNull().defaultNow(),
  disposeAfter: timestamp('dispose_after', { withTimezone: true }).notNull(),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const serviceRequestStatusEnum = pgEnum('service_request_status', [
  'open',
  'in_progress',
  'done',
  'cancelled',
]);

/** Service request types — aligned with housekeeping task types where applicable. */
export const serviceRequestTypeEnum = pgEnum('service_request_type', [
  'maintenance',
  'turndown',
  'deep_clean',
  'checkout',
  'stayover',
  'inspection',
  'service_request',
]);

/**
 * Guest or staff service requests that may spawn or link to a housekeeping task.
 */
export const serviceRequests = pgTable('service_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  propertyId: uuid('property_id').notNull().references(() => properties.id),
  roomId: uuid('room_id').references(() => rooms.id),
  reservationId: uuid('reservation_id').references(() => reservations.id),
  type: serviceRequestTypeEnum('type').notNull(),
  priority: integer('priority').notNull().default(0),
  status: serviceRequestStatusEnum('status').notNull().default('open'),
  title: varchar('title', { length: 255 }).notNull(),
  description: text('description'),
  linkedTaskId: uuid('linked_task_id').references(() => housekeepingTasks.id),
  requestedBy: uuid('requested_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
