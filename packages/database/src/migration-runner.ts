/**
 * Numbered SQL migration runner for schema changes from 0022 onward.
 *
 * Migrations 0001–0021 are incorporated idempotently by push-schema.ts (legacy
 * baseline). This runner records applied versions in schema_migrations and
 * executes each new .sql file once, inside a transaction.
 */
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type postgres from 'postgres';
import { pushSchema } from './push-schema.js';

/** Last migration version baked into push-schema.ts (baseline, not re-run). */
export const BASELINE_MIGRATION_VERSION = 21;

/** First version executed by this runner. */
export const FIRST_TRACKED_MIGRATION_VERSION = BASELINE_MIGRATION_VERSION + 1;

const MIGRATION_FILENAME_RE = /^(\d{4})_.+\.sql$/;

export type MigrationFile = {
  version: number;
  filename: string;
  path: string;
};

export function parseMigrationFilename(filename: string): number | null {
  const match = MIGRATION_FILENAME_RE.exec(filename);
  if (!match) return null;
  return Number.parseInt(match[1]!, 10);
}

export function resolveMigrationsDirectory(entryDir = dirname(fileURLToPath(import.meta.url))): string {
  return join(entryDir, 'migrations');
}

export async function listTrackedMigrationFiles(migrationsDir: string): Promise<MigrationFile[]> {
  const entries = await readdir(migrationsDir);
  const files: MigrationFile[] = [];

  for (const filename of entries) {
    const version = parseMigrationFilename(filename);
    if (version === null || version < FIRST_TRACKED_MIGRATION_VERSION) continue;
    files.push({
      version,
      filename,
      path: join(migrationsDir, filename),
    });
  }

  files.sort((a, b) => a.version - b.version);
  return files;
}

export async function ensureMigrationLedger(sql: postgres.Sql): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version integer PRIMARY KEY,
      filename varchar(255) NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `;
}

export async function getAppliedMigrationVersions(sql: postgres.Sql): Promise<Set<number>> {
  await ensureMigrationLedger(sql);
  const rows = await sql<{ version: number }[]>`
    SELECT version FROM schema_migrations ORDER BY version
  `;
  return new Set(rows.map((row) => row.version));
}

export async function runPendingSqlMigrations(
  sql: postgres.Sql,
  migrationsDir: string,
): Promise<string[]> {
  const pending = await listPendingMigrations(sql, migrationsDir);
  const applied: string[] = [];

  for (const migration of pending) {
    const body = await readFile(migration.path, 'utf8');
    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx`
        INSERT INTO schema_migrations (version, filename)
        VALUES (${migration.version}, ${migration.filename})
      `;
    });
    applied.push(migration.filename);
    console.log(`Applied migration ${migration.filename}`);
  }

  return applied;
}

export async function listPendingMigrations(
  sql: postgres.Sql,
  migrationsDir: string,
): Promise<MigrationFile[]> {
  const applied = await getAppliedMigrationVersions(sql);
  const files = await listTrackedMigrationFiles(migrationsDir);
  return files.filter((file) => !applied.has(file.version));
}

/**
 * Push legacy baseline schema, then apply tracked SQL migrations (0022+).
 */
export async function runAllMigrations(
  databaseUrl: string,
  options: {
    migrationsDir?: string;
    skipPushSchema?: boolean;
  } = {},
): Promise<void> {
  const postgresModule = await import('postgres');
  const defaultPostgres = postgresModule.default;
  const { postgresOptionsFromEnv } = await import('./postgres-options.js');

  const migrationsDir = options.migrationsDir ?? resolveMigrationsDirectory();

  if (!options.skipPushSchema) {
    console.log('Pushing baseline schema (migrations 0001–0021 via push-schema)...');
    await pushSchema(databaseUrl);
  }

  const sql = defaultPostgres(databaseUrl, postgresOptionsFromEnv());

  try {
    const applied = await runPendingSqlMigrations(sql, migrationsDir);
    if (applied.length === 0) {
      console.log('No pending SQL migrations.');
    } else {
      console.log(`SQL migrations applied: ${applied.join(', ')}`);
    }
  } finally {
    await sql.end();
  }
}
