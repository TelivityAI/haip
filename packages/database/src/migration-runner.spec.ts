/**
 * PostgreSQL integration tests for the numbered SQL migration runner (0022+).
 *
 * Uses ephemeral databases when Postgres is reachable (haip_test pattern).
 */
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { postgresOptionsFromEnv } from './postgres-options.js';
import { pushSchema } from './push-schema.js';
import {
  FIRST_TRACKED_MIGRATION_VERSION,
  getAppliedMigrationVersions,
  listPendingMigrations,
  resolveMigrationsDirectory,
  runAllMigrations,
  runPendingSqlMigrations,
} from './migration-runner.js';

const DEFAULT_DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://haip:haip@localhost:5432/haip_test';

const ADMIN_DATABASE_URL = DEFAULT_DATABASE_URL.replace(/\/[^/]+$/, '/postgres');

const MIGRATIONS_DIR = resolveMigrationsDirectory(
  dirname(fileURLToPath(import.meta.url)),
);

async function postgresReachable(url: string): Promise<boolean> {
  const client = postgres(url, { ...postgresOptionsFromEnv(), max: 1 });
  try {
    await client`SELECT 1`;
    return true;
  } catch {
    return false;
  } finally {
    await client.end();
  }
}

async function withEphemeralDatabase(run: (databaseUrl: string) => Promise<void>): Promise<void> {
  const dbName = `haip_mig_${randomBytes(6).toString('hex')}`;
  const admin = postgres(ADMIN_DATABASE_URL, { ...postgresOptionsFromEnv(), max: 1 });
  const databaseUrl = DEFAULT_DATABASE_URL.replace(/\/[^/]+$/, `/${dbName}`);

  await admin.unsafe(`CREATE DATABASE "${dbName}"`);
  try {
    await run(databaseUrl);
  } finally {
    await admin.unsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    await admin.end();
  }
}

async function columnExists(sql: postgres.Sql, column: string): Promise<boolean> {
  const rows = await sql<{ exists: boolean }[]>`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'webhook_deliveries'
        AND column_name = ${column}
    ) AS exists
  `;
  return rows[0]?.exists ?? false;
}

async function uniqueIndexExists(sql: postgres.Sql, indexName: string): Promise<boolean> {
  const rows = await sql<{ exists: boolean }[]>`
    SELECT EXISTS (
      SELECT 1
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname = ${indexName}
    ) AS exists
  `;
  return rows[0]?.exists ?? false;
}

async function seedWebhookDedupFixtures(sql: postgres.Sql) {
  const propertyId = 'f3500001-0000-4000-a000-000000000001';
  const subscriptionId = 'f3500002-0000-4000-a000-000000000002';
  const logicalEventId = 'f3500003-0000-4000-a000-000000000003';

  await sql`
    INSERT INTO properties (
      id, name, code, country_code, timezone, currency_code, total_rooms
    ) VALUES (
      ${propertyId},
      'Migration test property',
      ${`M350${randomBytes(2).toString('hex').toUpperCase()}`},
      'US',
      'America/New_York',
      'USD',
      10
    )
  `;

  await sql`
    INSERT INTO agent_webhook_subscriptions (
      id, property_id, subscriber_id, callback_url, events
    ) VALUES (
      ${subscriptionId},
      ${propertyId},
      'migration-test-subscriber',
      'https://example.com/webhooks',
      ${JSON.stringify(['reservation.created'])}
    )
  `;

  return { propertyId, subscriptionId, logicalEventId };
}

const postgresReady = await postgresReachable(DEFAULT_DATABASE_URL);

describe.skipIf(!postgresReady)('migration runner (PostgreSQL)', () => {
  beforeAll(async () => {
    if (!postgresReady) return;
    const canCreateDb = await postgresReachable(ADMIN_DATABASE_URL);
    if (!canCreateDb) {
      throw new Error('Postgres admin connection required for ephemeral migration tests');
    }
  });

  it('applies 0022 on a fresh database', async () => {
    await withEphemeralDatabase(async (databaseUrl) => {
      await runAllMigrations(databaseUrl, { migrationsDir: MIGRATIONS_DIR });

      const sql = postgres(databaseUrl, postgresOptionsFromEnv());
      try {
        expect(await columnExists(sql, 'logical_event_id')).toBe(true);
        expect(await uniqueIndexExists(
          sql,
          'webhook_deliveries_property_subscription_logical_event_unique',
        )).toBe(true);

        const applied = await getAppliedMigrationVersions(sql);
        expect(applied.has(FIRST_TRACKED_MIGRATION_VERSION)).toBe(true);
      } finally {
        await sql.end();
      }
    });
  });

  it('upgrades an existing pre-0022 database (push-schema baseline only)', async () => {
    await withEphemeralDatabase(async (databaseUrl) => {
      await pushSchema(databaseUrl);

      const sql = postgres(databaseUrl, postgresOptionsFromEnv());
      try {
        expect(await columnExists(sql, 'logical_event_id')).toBe(false);
        expect(await getAppliedMigrationVersions(sql).then((v) => v.size)).toBe(0);

        const pendingBefore = await listPendingMigrations(sql, MIGRATIONS_DIR);
        expect(pendingBefore.some((m) => m.version === FIRST_TRACKED_MIGRATION_VERSION)).toBe(true);

        await runPendingSqlMigrations(sql, MIGRATIONS_DIR);

        expect(await columnExists(sql, 'logical_event_id')).toBe(true);
        expect(await uniqueIndexExists(
          sql,
          'webhook_deliveries_property_subscription_logical_event_unique',
        )).toBe(true);
      } finally {
        await sql.end();
      }
    });
  });

  it('skips already-applied migrations when run twice (ledger idempotency)', async () => {
    await withEphemeralDatabase(async (databaseUrl) => {
      await runAllMigrations(databaseUrl, { migrationsDir: MIGRATIONS_DIR });

      const sql = postgres(databaseUrl, postgresOptionsFromEnv());
      try {
        const firstApplied = await getAppliedMigrationVersions(sql);
        expect(firstApplied.has(FIRST_TRACKED_MIGRATION_VERSION)).toBe(true);

        const secondPass = await runPendingSqlMigrations(sql, MIGRATIONS_DIR);
        expect(secondPass).toEqual([]);

        const appliedAfter = await getAppliedMigrationVersions(sql);
        expect(appliedAfter.size).toBe(firstApplied.size);
      } finally {
        await sql.end();
      }
    });
  });

  it('rejects duplicate (property_id, subscription_id, logical_event_id) rows', async () => {
    await withEphemeralDatabase(async (databaseUrl) => {
      await runAllMigrations(databaseUrl, { migrationsDir: MIGRATIONS_DIR });

      const sql = postgres(databaseUrl, postgresOptionsFromEnv());
      try {
        const { propertyId, subscriptionId, logicalEventId } = await seedWebhookDedupFixtures(sql);
        const payload = JSON.stringify({ eventType: 'reservation.created' });

        await sql`
          INSERT INTO webhook_deliveries (
            property_id, subscription_id, logical_event_id, event_type, payload
          ) VALUES (
            ${propertyId},
            ${subscriptionId},
            ${logicalEventId},
            'reservation.created',
            ${payload}::jsonb
          )
        `;

        await expect(sql`
          INSERT INTO webhook_deliveries (
            property_id, subscription_id, logical_event_id, event_type, payload
          ) VALUES (
            ${propertyId},
            ${subscriptionId},
            ${logicalEventId},
            'reservation.created',
            ${payload}::jsonb
          )
        `).rejects.toMatchObject({ code: '23505' });
      } finally {
        await sql.end();
      }
    });
  });
});

describe('migration runner (unit)', () => {
  it('resolves migrations adjacent to the compiled entry directory', () => {
    const dir = resolveMigrationsDirectory(join(dirname(fileURLToPath(import.meta.url))));
    expect(dir.endsWith(`${join('src', 'migrations')}`) || dir.endsWith(`${join('dist', 'migrations')}`)).toBe(true);
  });
});
