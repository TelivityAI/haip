import {
  bigserial,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

/**
 * Local extension of core's `audit_logs` table (see
 * `@telivityhaip/database` `schema/audit.ts`) adding the `booking_request_id`
 * column and `audit_logs_booking_request_timeline_idx` index this package
 * owns via its own migrations (0029_booking_request_audit_relationship,
 * 0032_booking_request_remediation). Core's push-schema and drizzle schema
 * intentionally do not declare this column/index — it is booking-requests-only
 * DDL, not core pollution. Mirrors every column of the core table so this
 * package can select/insert the same physical rows through one Drizzle table
 * reference that also knows about `bookingRequestId`.
 */
export const bookingRequestAuditLogs = pgTable('audit_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  propertyId: uuid('property_id'),
  bookingRequestId: uuid('booking_request_id'),

  action: varchar('action', { length: 50 }).notNull(),
  entityType: varchar('entity_type', { length: 50 }).notNull(),
  entityId: uuid('entity_id'),

  userId: uuid('user_id'),
  userEmail: varchar('user_email', { length: 255 }),
  ipAddress: varchar('ip_address', { length: 45 }),

  previousValue: jsonb('previous_value'),
  newValue: jsonb('new_value'),
  description: text('description'),

  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  timelineSequence: bigserial('timeline_sequence', { mode: 'bigint' }).notNull(),
}, (table) => ({
  bookingRequestTimeline: index('audit_logs_booking_request_timeline_idx')
    .on(table.propertyId, table.bookingRequestId, table.timelineSequence.desc()),
}));
