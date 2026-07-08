import { pgTable, uuid, varchar, text, timestamp, pgEnum, index } from 'drizzle-orm/pg-core';
import { properties } from './property.js';

export const staffNotificationSeverityEnum = pgEnum('staff_notification_severity', [
  'info',
  'warning',
  'critical',
]);

/**
 * Staff notifications — in-app alerts for property operators (anomalies, agent
 * decisions, audit issues). Broadcast rows have userId = null (visible to all
 * staff with access to the property). Per-user read state lives in
 * staff_notification_reads.
 */
export const staffNotifications = pgTable(
  'staff_notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id),
    // Nullable = broadcast to all staff at the property.
    userId: varchar('user_id', { length: 255 }),
    type: varchar('type', { length: 50 }).notNull(),
    title: varchar('title', { length: 255 }).notNull(),
    message: text('message').notNull(),
    severity: staffNotificationSeverityEnum('severity').notNull().default('info'),
    sourceEvent: varchar('source_event', { length: 100 }),
    sourceEntityType: varchar('source_entity_type', { length: 50 }),
    sourceEntityId: uuid('source_entity_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    propertyCreatedIdx: index('staff_notifications_property_created_idx').on(
      t.propertyId,
      t.createdAt,
    ),
  }),
);

export const staffNotificationReads = pgTable(
  'staff_notification_reads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    notificationId: uuid('notification_id')
      .notNull()
      .references(() => staffNotifications.id),
    userId: varchar('user_id', { length: 255 }).notNull(),
    readAt: timestamp('read_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqueRead: index('staff_notification_reads_unique').on(t.notificationId, t.userId),
  }),
);
