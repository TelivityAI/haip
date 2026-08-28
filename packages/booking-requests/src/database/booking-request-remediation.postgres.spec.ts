/**
 * Ported from PR #347's packages/database/src/booking-request-remediation.postgres.spec.ts
 * (https://github.com/TelivityAI/haip/pull/347), adapted for the standalone
 * @telivityhaip/booking-requests package and its ledger-based migration runner.
 *
 * #347 exercised these races through `push-schema` (idempotent — every ALTER
 * runs on every install, fresh or upgrading) because at that point this
 * migration's DDL was duplicated inline in push-schema. Now that the DDL lives
 * only in migration 0032 and this package's migrator applies each file once
 * (recorded in the `booking_requests_schema_migrations` ledger — see
 * migrate.ts), a reverted-then-re-applied migration can no longer be driven
 * through the migrator itself (the ledger would just skip it as already
 * applied). These tests instead replay migration 0032's actual SQL directly
 * against a database whose state has been rolled back to just before it —
 * exercising the identical production DDL/backfill logic, independent of the
 * ledger wrapper around it.
 *
 * Opt-in and skipped by default (like #347's version): these are slow,
 * timing-sensitive concurrency tests. Run with
 * `BOOKING_REQUEST_REMEDIATION_LIVE_PG=1 DATABASE_URL=... pnpm test`.
 */
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { runPendingBookingRequestsMigrations } from './migrate.js';

const databaseUrl = process.env['DATABASE_URL'];
const live = process.env['BOOKING_REQUEST_REMEDIATION_LIVE_PG'] === '1';
const suite = live && databaseUrl ? describe : describe.skip;
const migrationsDir = fileURLToPath(new URL('./migrations', import.meta.url));
const migrationSql = readFileSync(
  new URL('./migrations/0032_booking_request_remediation.sql', import.meta.url),
  'utf8',
);

function databaseUrlFor(name: string) {
  const url = new URL(databaseUrl!);
  url.pathname = `/${name}`;
  url.search = '';
  return url.toString();
}

function splitSqlStatements(source: string) {
  const statements: string[] = [];
  let statement = '';
  let singleQuoted = false;
  let doubleQuoted = false;
  let lineComment = false;
  let blockComment = false;
  let dollarTag: string | null = null;
  for (let index = 0; index < source.length; index++) {
    const char = source[index]!;
    const next = source[index + 1];
    if (lineComment) {
      statement += char;
      if (char === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      statement += char;
      if (char === '*' && next === '/') {
        statement += next;
        index++;
        blockComment = false;
      }
      continue;
    }
    if (dollarTag) {
      if (source.startsWith(dollarTag, index)) {
        statement += dollarTag;
        index += dollarTag.length - 1;
        dollarTag = null;
      } else statement += char;
      continue;
    }
    if (!singleQuoted && !doubleQuoted && char === '-' && next === '-') {
      statement += `${char}${next}`;
      index++;
      lineComment = true;
      continue;
    }
    if (!singleQuoted && !doubleQuoted && char === '/' && next === '*') {
      statement += `${char}${next}`;
      index++;
      blockComment = true;
      continue;
    }
    if (!singleQuoted && !doubleQuoted && char === '$') {
      const tag = source.slice(index).match(/^\$[A-Za-z0-9_]*\$/)?.[0];
      if (tag) {
        statement += tag;
        index += tag.length - 1;
        dollarTag = tag;
        continue;
      }
    }
    if (!doubleQuoted && char === "'") {
      statement += char;
      if (singleQuoted && next === "'") {
        statement += next;
        index++;
      } else singleQuoted = !singleQuoted;
      continue;
    }
    if (!singleQuoted && char === '"') {
      statement += char;
      if (doubleQuoted && next === '"') {
        statement += next;
        index++;
      } else doubleQuoted = !doubleQuoted;
      continue;
    }
    if (!singleQuoted && !doubleQuoted && char === ';') {
      if (statement.trim()) statements.push(statement.trim());
      statement = '';
    } else statement += char;
  }
  if (statement.trim()) statements.push(statement.trim());
  return statements;
}

async function replayRemediationMigration(client: ReturnType<typeof postgres>) {
  for (const statement of splitSqlStatements(migrationSql)) {
    await client.unsafe(statement);
  }
}

async function waitForSleep(client: ReturnType<typeof postgres>) {
  for (let attempt = 0; attempt < 300; attempt++) {
    const [row] = await client<{ count: number }[]>`
      SELECT count(*)::int AS count
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND pid <> pg_backend_pid()
        AND wait_event = 'PgSleep'
    `;
    if ((row?.count ?? 0) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('migration backfill pause was not observed');
}

suite('booking request remediation against PostgreSQL', () => {
  const databases: string[] = [];
  const clients = new Set<ReturnType<typeof postgres>>();
  const adminUrl = (() => {
    const url = new URL(databaseUrl ?? 'postgres://localhost/postgres');
    url.pathname = '/postgres';
    url.search = '';
    return url.toString();
  })();
  const admin = postgres(adminUrl, {
    max: 1,
    connect_timeout: 5,
    connection: { lock_timeout: 5_000, statement_timeout: 5_000 },
  });

  /** A scratch database with core migrations + every packaged booking-requests
   * migration (0022-0032) already applied — i.e. today's final schema. */
  async function createDatabase(label: string) {
    const suffix = randomBytes(10).toString('hex');
    const name = `task7_remediation_${label}_${suffix}`;
    await admin.unsafe(`CREATE DATABASE "${name}"`);
    databases.push(name);
    const url = databaseUrlFor(name);

    const migrationClient = postgres(url, { max: 1 });
    try {
      const { execFileSync } = await import('node:child_process');
      execFileSync('node', ['packages/database/dist/run-migrations.js'], {
        cwd: fileURLToPath(new URL('../../../..', import.meta.url)),
        env: { ...process.env, DATABASE_URL: url },
        stdio: 'pipe',
      });
      await runPendingBookingRequestsMigrations(migrationClient, migrationsDir);
    } finally {
      await migrationClient.end();
    }

    const client = postgres(url, { max: 8 });
    clients.add(client);
    return { url, client };
  }

  afterEach(async () => {
    const openClients = [...clients];
    clients.clear();
    const results = await Promise.allSettled(openClients.map((client) => client.end({ timeout: 2 })));
    const failures = results
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map((result) => result.reason);
    if (failures.length > 0) throw new AggregateError(failures, 'live test cleanup failed');
  });

  afterAll(async () => {
    const failures: unknown[] = [];
    const drops = await Promise.allSettled(databases.map((name) =>
      admin.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`),
    ));
    for (const result of drops) {
      if (result.status === 'rejected') failures.push(result.reason);
    }
    try {
      await admin.end({ timeout: 2 });
    } catch (error) {
      failures.push(error);
    }
    if (failures.length > 0) throw new AggregateError(failures, 'database teardown failed');
  });

  it('replaying migration 0032 blocks old audit writers until timeline backfill/default/not-null are atomic', async () => {
    const { client } = await createDatabase('audit_null');
    await client.unsafe(`
      DROP INDEX IF EXISTS audit_logs_booking_request_timeline_idx;
      DROP INDEX IF EXISTS audit_logs_timeline_sequence_unique;
      ALTER TABLE audit_logs DROP COLUMN timeline_sequence;
      DROP SEQUENCE IF EXISTS audit_logs_timeline_sequence_seq;
      CREATE FUNCTION task7_pause_audit_backfill() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = current_schema()
            AND table_name = 'audit_logs'
            AND column_name = 'timeline_sequence'
        ) THEN
          PERFORM pg_sleep(1);
        END IF;
        RETURN NULL;
      END $$;
      CREATE TRIGGER task7_pause_audit_backfill
        AFTER UPDATE ON audit_logs FOR EACH STATEMENT
        EXECUTE FUNCTION task7_pause_audit_backfill();
    `);

    const replay = replayRemediationMigration(client);
    await waitForSleep(client);
    const oldWriter = client`
      INSERT INTO audit_logs (action, entity_type, occurred_at)
      VALUES ('create', 'legacy_writer', '2026-08-26T10:00:00Z')
      RETURNING timeline_sequence
    `;
    await Promise.all([replay, oldWriter]);

    const [row] = await client<{ timelineSequence: string }[]>`
      SELECT timeline_sequence::text AS "timelineSequence"
      FROM audit_logs WHERE entity_type = 'legacy_writer'
    `;
    expect(row?.timelineSequence).toMatch(/^[1-9]\d*$/);
  }, 30_000);

  it('replaying migration 0032 keeps old booking-request inserts valid during the submitted-total transition', async () => {
    const { client } = await createDatabase('request_null');
    await client.unsafe(`
      INSERT INTO properties
        (id, name, code, country_code, timezone, currency_code, total_rooms)
      VALUES
        ('73000000-0000-4000-a000-000000000001', 'Migration race', 'T7RACE',
          'ES', 'Europe/Madrid', 'EUR', 1);
      INSERT INTO room_types
        (id, property_id, name, code, max_occupancy, default_occupancy)
      VALUES
        ('73000000-0000-4000-a000-000000000002',
          '73000000-0000-4000-a000-000000000001', 'Race room', 'RACE', 2, 1);
      INSERT INTO rate_plans
        (id, property_id, room_type_id, name, code, type, base_amount, currency_code)
      VALUES
        ('73000000-0000-4000-a000-000000000003',
          '73000000-0000-4000-a000-000000000001',
          '73000000-0000-4000-a000-000000000002', 'Race rate', 'RACE', 'bar', 100, 'EUR');
      DROP TRIGGER IF EXISTS booking_requests_submitted_total_compat ON booking_requests;
      ALTER TABLE booking_requests DROP COLUMN submitted_total;
      CREATE FUNCTION task7_pause_request_backfill() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = current_schema()
            AND table_name = 'booking_requests'
            AND column_name = 'submitted_total'
        ) THEN
          PERFORM pg_sleep(1);
        END IF;
        RETURN NULL;
      END $$;
      CREATE TRIGGER task7_pause_request_backfill
        AFTER UPDATE ON booking_requests FOR EACH STATEMENT
        EXECUTE FUNCTION task7_pause_request_backfill();
    `);

    const replay = replayRemediationMigration(client);
    await waitForSleep(client);
    const oldWriter = client.unsafe(`
      INSERT INTO booking_requests
        (id, property_id, submission_idempotency_key, submission_fingerprint,
          arrival_date, departure_date, room_type_id, rate_plan_id,
          guest_first_name, guest_last_name, guest_email,
          submitted_quote_snapshot, currency_code)
      VALUES
        ('73000000-0000-4000-a000-000000000004',
          '73000000-0000-4000-a000-000000000001', 'legacy-race', '${'a'.repeat(64)}',
          '2026-10-01', '2026-10-02',
          '73000000-0000-4000-a000-000000000002',
          '73000000-0000-4000-a000-000000000003',
          'Legacy', 'Writer', 'legacy@example.invalid',
          '{
            "currencyCode":"EUR",
            "grandTotal":"123.45",
            "roomTotal":"123.45",
            "taxTotal":"0.00",
            "servicesTotal":"0.00",
            "servicesTaxTotal":"0.00",
            "lineItems":[{"date":"2026-10-01","rate":"123.45","tax":"0.00"}],
            "services":[]
          }'::jsonb, 'EUR')
      RETURNING submitted_total
    `);
    await Promise.all([replay, oldWriter]);

    const [row] = await client<{ submittedTotal: string }[]>`
      SELECT submitted_total::text AS "submittedTotal"
      FROM booking_requests WHERE submission_idempotency_key = 'legacy-race'
    `;
    expect(row?.submittedTotal).toBe('123.45');
  }, 30_000);

  it('replaying migration 0032 never reuses a sequence value reserved before its table lock', async () => {
    const { client } = await createDatabase('sequence');
    await client.unsafe(`
      TRUNCATE audit_logs RESTART IDENTITY;
      INSERT INTO audit_logs (action, entity_type, occurred_at)
      VALUES ('create', 'committed', '2026-08-26T10:00:00Z');
    `);

    const [reserved] = await client<{ value: string }[]>`
      SELECT nextval('audit_logs_timeline_sequence_seq')::text AS value
    `;
    expect(reserved?.value).toBe('2');

    await replayRemediationMigration(client);
    const [inserted] = await client<{ timelineSequence: string }[]>`
      INSERT INTO audit_logs (action, entity_type, occurred_at)
      VALUES ('create', 'after_replay', '2026-08-26T10:00:02Z')
      RETURNING timeline_sequence::text AS "timelineSequence"
    `;
    expect(inserted?.timelineSequence).toBe('3');
    const [ownership] = await client<{ ownedSequence: string | null }[]>`
      SELECT pg_get_serial_sequence('audit_logs', 'timeline_sequence') AS "ownedSequence"
    `;
    expect(ownership?.ownedSequence).toBe('public.audit_logs_timeline_sequence_seq');
  }, 30_000);

  it('replaying migration 0032 preserves an unissued sequence value ahead of a nonempty table maximum', async () => {
    const { client } = await createDatabase('uncalled_sequence');
    await client.unsafe(`
      TRUNCATE audit_logs RESTART IDENTITY;
      INSERT INTO audit_logs
        (action, entity_type, occurred_at, timeline_sequence)
      VALUES ('create', 'committed', '2026-08-26T10:00:00Z', 5);
      SELECT setval('audit_logs_timeline_sequence_seq'::regclass, 10, false);
    `);

    await replayRemediationMigration(client);

    const [state] = await client<{ lastValue: string; isCalled: boolean }[]>`
      SELECT last_value::text AS "lastValue", is_called AS "isCalled"
      FROM audit_logs_timeline_sequence_seq
    `;
    expect(state).toEqual({ lastValue: '10', isCalled: false });
    const [inserted] = await client<{ timelineSequence: string }[]>`
      INSERT INTO audit_logs (action, entity_type, occurred_at)
      VALUES ('create', 'after_replay', '2026-08-26T10:00:01Z')
      RETURNING timeline_sequence::text AS "timelineSequence"
    `;
    expect(inserted?.timelineSequence).toBe('10');
  }, 30_000);

  it.each([
    { caseLabel: 'equal to', sequenceValue: 5 },
    { caseLabel: 'behind', sequenceValue: 3 },
  ])('replaying migration 0032 marks an uncalled sequence $caseLabel the populated table maximum as called', async ({ sequenceValue }) => {
    const { client } = await createDatabase(`uncalled_${sequenceValue}`);
    await client.unsafe(`
      TRUNCATE audit_logs RESTART IDENTITY;
      INSERT INTO audit_logs
        (action, entity_type, occurred_at, timeline_sequence)
      VALUES ('create', 'committed', '2026-08-26T10:00:00Z', 5);
      SELECT setval('audit_logs_timeline_sequence_seq'::regclass, ${sequenceValue}, false);
    `);

    await replayRemediationMigration(client);

    const [state] = await client<{ lastValue: string; isCalled: boolean }[]>`
      SELECT last_value::text AS "lastValue", is_called AS "isCalled"
      FROM audit_logs_timeline_sequence_seq
    `;
    expect(state).toEqual({ lastValue: '5', isCalled: true });
    const [inserted] = await client<{ timelineSequence: string }[]>`
      INSERT INTO audit_logs (action, entity_type, occurred_at)
      VALUES ('create', 'after_replay', '2026-08-26T10:00:01Z')
      RETURNING timeline_sequence::text AS "timelineSequence"
    `;
    expect(inserted?.timelineSequence).toBe('6');
  }, 30_000);
});
