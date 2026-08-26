import { afterAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const databaseUrl = process.env['DATABASE_URL'];
const live = process.env['BOOKING_REQUEST_REMEDIATION_LIVE_PG'] === '1';
const suite = live && databaseUrl ? describe : describe.skip;
const packageDirectory = fileURLToPath(new URL('..', import.meta.url));
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

function startPushSchema(url: string) {
  const child = spawn('pnpm', ['db:migrate'], {
    cwd: packageDirectory,
    env: { ...process.env, DATABASE_URL: url },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += String(chunk); });
  child.stderr.on('data', (chunk) => { output += String(chunk); });
  return new Promise<void>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`push-schema exited ${code}\n${output}`));
    });
  });
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
  const adminUrl = (() => {
    const url = new URL(databaseUrl ?? 'postgres://localhost/postgres');
    url.pathname = '/postgres';
    url.search = '';
    return url.toString();
  })();
  const admin = postgres(adminUrl, { max: 1 });

  async function createDatabase(label: string) {
    const name = `task7_remediation_${label}_${process.pid}`;
    await admin.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE "${name}"`);
    databases.push(name);
    const url = databaseUrlFor(name);
    await startPushSchema(url);
    return { url, client: postgres(url, { max: 8 }) };
  }

  afterAll(async () => {
    await Promise.all(databases.map(async (name) => {
      await admin.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    }));
    await admin.end();
  });

  it('push-schema blocks old audit writers until timeline backfill/default/not-null are atomic', async () => {
    const { url, client } = await createDatabase('audit_null');
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

    const push = startPushSchema(url);
    await waitForSleep(client);
    const oldWriter = client`
      INSERT INTO audit_logs (action, entity_type, occurred_at)
      VALUES ('create', 'legacy_writer', '2026-08-26T10:00:00Z')
      RETURNING timeline_sequence
    `;
    await Promise.all([push, oldWriter]);

    const [row] = await client<{ timelineSequence: string }[]>`
      SELECT timeline_sequence::text AS "timelineSequence"
      FROM audit_logs WHERE entity_type = 'legacy_writer'
    `;
    expect(row?.timelineSequence).toMatch(/^[1-9]\d*$/);
    await client.end();
  }, 30_000);

  it('push-schema keeps old booking-request inserts valid during the submitted-total transition', async () => {
    const { url, client } = await createDatabase('request_null');
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

    const push = startPushSchema(url);
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
    await Promise.all([push, oldWriter]);

    const [row] = await client<{ submittedTotal: string }[]>`
      SELECT submitted_total::text AS "submittedTotal"
      FROM booking_requests WHERE submission_idempotency_key = 'legacy-race'
    `;
    expect(row?.submittedTotal).toBe('123.45');
    await client.end();
  }, 30_000);

  it('migration replay never rewinds a sequence value held by an uncommitted audit insert', async () => {
    const { client } = await createDatabase('sequence');
    await client.unsafe(`
      TRUNCATE audit_logs RESTART IDENTITY;
      INSERT INTO audit_logs (action, entity_type, occurred_at)
      VALUES ('create', 'committed', '2026-08-26T10:00:00Z');
      CREATE FUNCTION task7_pause_sequence_replay() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        PERFORM pg_sleep(1);
        RETURN NULL;
      END $$;
      CREATE TRIGGER task7_pause_sequence_replay
        AFTER UPDATE ON audit_logs FOR EACH STATEMENT
        EXECUTE FUNCTION task7_pause_sequence_replay();
    `);

    const replay = (async () => {
      for (const statement of splitSqlStatements(migrationSql)) {
        await client.unsafe(statement);
      }
    })();
    await waitForSleep(client);
    const uncommittedWriter = client.begin(async (tx) => {
      await tx`
        INSERT INTO audit_logs (action, entity_type, occurred_at)
        VALUES ('create', 'uncommitted_during_replay', '2026-08-26T10:00:01Z')
      `;
      await tx`SELECT pg_sleep(1.5)`;
    });
    await Promise.all([replay, uncommittedWriter]);
    await client`
      INSERT INTO audit_logs (action, entity_type, occurred_at)
      VALUES ('create', 'after_replay', '2026-08-26T10:00:02Z')
    `;

    const rows = await client<{ entityType: string; timelineSequence: string }[]>`
      SELECT entity_type AS "entityType", timeline_sequence::text AS "timelineSequence"
      FROM audit_logs
      WHERE entity_type IN ('committed', 'uncommitted_during_replay', 'after_replay')
      ORDER BY timeline_sequence
    `;
    expect(rows).toEqual([
      { entityType: 'committed', timelineSequence: '1' },
      { entityType: 'uncommitted_during_replay', timelineSequence: '2' },
      { entityType: 'after_replay', timelineSequence: '3' },
    ]);
    const [ownership] = await client<{ ownedSequence: string | null }[]>`
      SELECT pg_get_serial_sequence('audit_logs', 'timeline_sequence') AS "ownedSequence"
    `;
    expect(ownership?.ownedSequence).toBe('public.audit_logs_timeline_sequence_seq');
    await client.end();
  }, 30_000);
});
