import { pgTable, uuid, varchar, text, timestamp, jsonb, date, numeric, pgEnum, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { properties } from './property.js';

/**
 * Night audit run status (KB 5.8).
 */
export const auditRunStatusEnum = pgEnum('audit_run_status', [
  'running',
  'completed',
  'failed',
  'rolled_back',
]);

/**
 * Night Audit Runs — tracks each nightly audit execution (KB 5.8).
 * Night audit: post room tariffs, process no-shows, revenue reconciliation, day close.
 * All transactions locked after day close.
 */
export const auditRuns = pgTable('audit_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  propertyId: uuid('property_id').notNull().references(() => properties.id),
  businessDate: date('business_date').notNull(), // The date being closed

  status: auditRunStatusEnum('status').notNull().default('running'),

  // Counts
  roomChargesPosted: numeric('room_charges_posted', { precision: 12, scale: 2 }),
  taxChargesPosted: numeric('tax_charges_posted', { precision: 12, scale: 2 }),
  noShowsProcessed: numeric('no_shows_processed', { precision: 4, scale: 0 }),

  // Results
  summary: jsonb('summary'), // Revenue reconciliation summary
  errors: jsonb('errors').$type<Array<{ message: string; entity?: string }>>(),

  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  // Bug 4: prevent concurrent night audit runs for the same property/date.
  uniquePropertyDate: uniqueIndex('night_audit_runs_property_date_unique')
    .on(table.propertyId, table.businessDate),
}));

/**
 * Audit Log — GDPR audit trail for all data access and modifications.
 * Required by GDPR (KB 5.10) and PCI DSS.
 */
export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  propertyId: uuid('property_id').references(() => properties.id), // Null for system-level events
  bookingRequestId: uuid('booking_request_id'),

  // What happened
  action: varchar('action', { length: 50 }).notNull(), // "create", "update", "delete", "access", "export"
  entityType: varchar('entity_type', { length: 50 }).notNull(), // "reservation", "guest", "folio", "payment"
  entityId: uuid('entity_id'),

  // Who did it
  userId: uuid('user_id'), // Staff user or API client
  userEmail: varchar('user_email', { length: 255 }),
  ipAddress: varchar('ip_address', { length: 45 }),

  // What changed
  previousValue: jsonb('previous_value'),
  newValue: jsonb('new_value'),
  description: text('description'),

  // Immutable timestamp — this is the audit trail
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  propertyEntityTimeline: index('audit_logs_property_entity_timeline_idx')
    .on(table.propertyId, table.entityType, table.entityId, table.occurredAt, table.id),
  bookingRequestTimeline: index('audit_logs_booking_request_timeline_idx')
    .on(table.propertyId, table.bookingRequestId, table.occurredAt.desc(), table.id.desc()),
}));
