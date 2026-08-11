import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  timestamp,
  integer,
  jsonb,
  pgEnum,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { properties } from './property.js';

/** Status of a durable migration import job. */
export const migrationJobStatusEnum = pgEnum('migration_job_status', [
  'pending',
  'running',
  'completed',
  'failed',
  'paused',
]);

/** Per-row outcome within a migration job. */
export const migrationRowStatusEnum = pgEnum('migration_row_status', [
  'pending',
  'succeeded',
  'failed',
  'skipped',
]);

/**
 * Maps legacy PMS identifiers to HAIP UUIDs within a migration project.
 * Enables reservation import (and other steps) without callers knowing HAIP ids.
 */
export const migrationLegacyIdMap = pgTable(
  'migration_legacy_id_map',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    propertyId: uuid('property_id').notNull().references(() => properties.id),
    projectId: varchar('project_id', { length: 120 }).notNull(),
    entity: varchar('entity', { length: 80 }).notNull(),
    legacyId: varchar('legacy_id', { length: 120 }).notNull(),
    haipId: uuid('haip_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniq: uniqueIndex('migration_legacy_id_map_project_entity_legacy_unique').on(
      t.propertyId,
      t.projectId,
      t.entity,
      t.legacyId,
    ),
  }),
);

/** Durable, resumable batch-import job (one entity per job). */
export const migrationJobs = pgTable('migration_jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  propertyId: uuid('property_id').notNull().references(() => properties.id),
  projectId: varchar('project_id', { length: 120 }).notNull(),
  entity: varchar('entity', { length: 80 }).notNull(),
  status: migrationJobStatusEnum('status').notNull().default('pending'),
  dryRun: boolean('dry_run').notNull().default(false),
  payload: jsonb('payload')
    .$type<{
      rows?: Record<string, string>[];
      mapping?: Record<string, string>;
      reservations?: Record<string, unknown>[];
    }>()
    .notNull(),
  checkpointCursor: integer('checkpoint_cursor').notNull().default(0),
  totalRows: integer('total_rows').notNull().default(0),
  processedRows: integer('processed_rows').notNull().default(0),
  succeededRows: integer('succeeded_rows').notNull().default(0),
  failedRows: integer('failed_rows').notNull().default(0),
  attempts: integer('attempts').notNull().default(0),
  lastError: text('last_error'),
  nextRetryAt: timestamp('next_retry_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
});

/** Per-row import outcome for observability and resume safety. */
export const migrationRowResults = pgTable(
  'migration_row_results',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    jobId: uuid('job_id')
      .notNull()
      .references(() => migrationJobs.id),
    propertyId: uuid('property_id').notNull().references(() => properties.id),
    rowIndex: integer('row_index').notNull(),
    status: migrationRowStatusEnum('status').notNull().default('pending'),
    legacyId: varchar('legacy_id', { length: 120 }),
    haipId: uuid('haip_id'),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniq: uniqueIndex('migration_row_results_job_row_unique').on(t.jobId, t.rowIndex),
  }),
);
