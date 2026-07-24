import { pgTable, uuid, varchar, text, boolean, timestamp, date, pgEnum, index } from 'drizzle-orm/pg-core';
import { properties } from './property.js';
import { roomTypes } from './room.js';

export const icalFeedDirectionEnum = pgEnum('ical_feed_direction', [
  'import',
  'export',
]);

export const icalFeeds = pgTable('ical_feeds', {
  id: uuid('id').primaryKey().defaultRandom(),
  propertyId: uuid('property_id').notNull().references(() => properties.id),
  roomTypeId: uuid('room_type_id').notNull().references(() => roomTypes.id),

  direction: icalFeedDirectionEnum('direction').notNull(),
  name: varchar('name', { length: 120 }).notNull(),

  // Import feeds fetch sourceUrl. Export feeds verify tokenHash.
  sourceUrl: text('source_url'),
  tokenHash: varchar('token_hash', { length: 64 }),

  isActive: boolean('is_active').notNull().default(true),
  lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
  lastSyncStatus: varchar('last_sync_status', { length: 20 }),
  lastSyncError: text('last_sync_error'),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  propertyRoomDirectionIdx: index('ical_feeds_property_room_direction_idx')
    .on(table.propertyId, table.roomTypeId, table.direction),
}));

export const icalBlocks = pgTable('ical_blocks', {
  id: uuid('id').primaryKey().defaultRandom(),
  propertyId: uuid('property_id').notNull().references(() => properties.id),
  feedId: uuid('feed_id').notNull().references(() => icalFeeds.id),
  roomTypeId: uuid('room_type_id').notNull().references(() => roomTypes.id),

  externalUid: varchar('external_uid', { length: 255 }).notNull(),
  startDate: date('start_date').notNull(),
  endDate: date('end_date').notNull(),
  summary: varchar('summary', { length: 255 }),
  sourceChecksum: varchar('source_checksum', { length: 64 }).notNull(),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  propertyRoomDatesIdx: index('ical_blocks_property_room_dates_idx')
    .on(table.propertyId, table.roomTypeId, table.startDate, table.endDate),
  feedDatesIdx: index('ical_blocks_feed_dates_idx')
    .on(table.feedId, table.startDate, table.endDate),
}));
