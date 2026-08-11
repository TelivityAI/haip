import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  text,
  integer,
  jsonb,
  timestamp,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { properties } from './property.js';

/**
 * PMS migration jobs — durable, resumable batch imports (TEL-67).
 *
 * A migration job is one entity-batch inside a wider migration project owned by
 * Remy (project ids are external references — HAIP does not depend on the Remy
 * DB). Rows are processed in chunks by a BullMQ worker; `processedRows` is the
 * checkpoint cursor and `migration_legacy_id_map` makes re-runs idempotent.
 */
export const migrationJobStatusEnum = pgEnum('migration_job_status', [
  'pending',
  'running',
  'completed',
  'completed_with_errors',
  'failed',
  'cancelled',
]);

export const migrationEntityEnum = pgEnum('migration_entity', [
  'guests',
  'room-types',
  'rooms',
  'rate-plans',
  'reservations',
  'folio-balances',
]);

export const migrationJobs = pgTable(
  'migration_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id),
    /** External project reference (Remy migration project id or manual run). */
    projectRef: varchar('project_ref', { length: 120 }).notNull(),
    entity: migrationEntityEnum('entity').notNull(),
    status: migrationJobStatusEnum('status').notNull().default('pending'),
    /** Source rows staged for processing. */
    rows: jsonb('rows').notNull(),
    totalRows: integer('total_rows').notNull(),
    /** Checkpoint cursor — index of the next unprocessed row. */
    processedRows: integer('processed_rows').notNull().default(0),
    createdCount: integer('created_count').notNull().default(0),
    /** Skipped because the legacy id was already imported (idempotent re-run). */
    skippedCount: integer('skipped_count').notNull().default(0),
    failedCount: integer('failed_count').notNull().default(0),
    /** Row-level errors: [{ index, legacyId?, error }]. */
    errors: jsonb('errors').notNull().default([]),
    dryRun: varchar('dry_run', { length: 5 }).notNull().default('false'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    propertyStatusIdx: index('migration_jobs_property_status_idx').on(t.propertyId, t.status),
    projectIdx: index('migration_jobs_project_ref_idx').on(t.propertyId, t.projectRef),
  }),
);

/**
 * Legacy identity map — the linchpin of idempotent migration. One row per
 * imported entity instance: (property, project, entity, legacy id) → HAIP uuid.
 * Reservation/folio steps resolve their references through this table, and
 * re-runs skip already-mapped rows instead of duplicating them.
 */
export const migrationLegacyIdMap = pgTable(
  'migration_legacy_id_map',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id),
    projectRef: varchar('project_ref', { length: 120 }).notNull(),
    entity: migrationEntityEnum('entity').notNull(),
    legacyId: varchar('legacy_id', { length: 255 }).notNull(),
    haipId: uuid('haip_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniq: uniqueIndex('migration_legacy_id_map_unique').on(
      t.propertyId,
      t.projectRef,
      t.entity,
      t.legacyId,
    ),
    lookupIdx: index('migration_legacy_id_map_lookup_idx').on(
      t.propertyId,
      t.projectRef,
      t.entity,
      t.haipId,
    ),
  }),
);

/**
 * Source-PMS credentials for API-pull connectors (TEL-70). Ciphertext only —
 * app-level AES-256-GCM; plaintext never leaves the migration service.
 */
export const migrationSourceCredentials = pgTable(
  'migration_source_credentials',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id),
    sourcePms: varchar('source_pms', { length: 60 }).notNull(),
    /** AES-256-GCM payload: v1.<kid>.<b64 iv>.<b64 tag>.<b64 ciphertext>. */
    ciphertext: text('ciphertext').notNull(),
    /** Identifies which key encrypted this row (rotation seam). */
    keyId: varchar('key_id', { length: 40 }).notNull(),
    createdBy: varchar('created_by', { length: 255 }),
    rotatedAt: timestamp('rotated_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniq: uniqueIndex('migration_source_credentials_unique').on(t.propertyId, t.sourcePms),
  }),
);
