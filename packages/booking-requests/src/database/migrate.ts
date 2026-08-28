import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://haip:haip@localhost:5432/haip';

/** Ledger separate from core `schema_migrations` to avoid version collisions. */
export const BOOKING_REQUESTS_MIGRATIONS_TABLE = 'booking_requests_schema_migrations';

const MIGRATION_FILENAME_RE = /^(\d{4})_.+\.sql$/;

export type BookingRequestsMigrationFile = {
  version: number;
  filename: string;
  path: string;
};

export function resolveMigrationsDirectory(
  entryDir = dirname(fileURLToPath(import.meta.url)),
): string {
  return join(entryDir, 'migrations');
}

export function parseMigrationFilename(filename: string): number | null {
  const match = MIGRATION_FILENAME_RE.exec(filename);
  if (!match) return null;
  return Number.parseInt(match[1]!, 10);
}

export async function listMigrationFiles(
  migrationsDir: string,
): Promise<BookingRequestsMigrationFile[]> {
  const entries = await readdir(migrationsDir);
  const files: BookingRequestsMigrationFile[] = [];
  for (const filename of entries) {
    const version = parseMigrationFilename(filename);
    if (version === null) continue;
    files.push({
      version,
      filename,
      path: join(migrationsDir, filename),
    });
  }
  files.sort((a, b) => a.version - b.version || a.filename.localeCompare(b.filename));
  return files;
}

export function checksumSql(body: string): string {
  return createHash('sha256').update(body).digest('hex');
}

function stripLineComments(sql: string): string {
  let result = '';
  let dollarQuote: string | null = null;
  let inSingleQuote = false;

  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    if (dollarQuote) {
      if (sql.startsWith(dollarQuote, i)) {
        result += dollarQuote;
        i += dollarQuote.length - 1;
        dollarQuote = null;
      } else {
        result += ch;
      }
      continue;
    }

    if (inSingleQuote) {
      result += ch;
      if (ch === '\'' && sql[i + 1] === '\'') {
        result += sql[i + 1];
        i += 1;
        continue;
      }
      if (ch === '\'') inSingleQuote = false;
      continue;
    }

    if (ch === '$') {
      const match = sql.slice(i).match(/^(\$[A-Za-z0-9_]*\$)/);
      if (match) {
        dollarQuote = match[1]!;
        result += dollarQuote;
        i += dollarQuote.length - 1;
        continue;
      }
    }

    if (ch === '\'') {
      inSingleQuote = true;
      result += ch;
      continue;
    }

    if (ch === '-' && sql[i + 1] === '-') {
      while (i < sql.length && sql[i] !== '\n') i += 1;
      result += '\n';
      continue;
    }

    result += ch;
  }

  return result;
}

function stripLeadingLineComments(statement: string): string {
  return statement.replace(/^(\s*--[^\n]*\n)+/, '').trim();
}

function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let dollarQuote: string | null = null;

  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    if (dollarQuote) {
      if (sql.startsWith(dollarQuote, i)) {
        current += dollarQuote;
        i += dollarQuote.length - 1;
        dollarQuote = null;
      } else {
        current += ch;
      }
      continue;
    }

    if (ch === '$') {
      const match = sql.slice(i).match(/^(\$[A-Za-z0-9_]*\$)/);
      if (match) {
        dollarQuote = match[1]!;
        current += dollarQuote;
        i += dollarQuote.length - 1;
        continue;
      }
    }

    if (ch === ';') {
      current += ch;
      const trimmed = stripLeadingLineComments(current);
      if (trimmed) {
        statements.push(trimmed);
      }
      current = '';
      continue;
    }

    current += ch;
  }

  const tail = stripLeadingLineComments(current);
  if (tail) {
    statements.push(tail);
  }

  return statements;
}

export async function ensureMigrationLedger(sql: postgres.Sql): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS booking_requests_schema_migrations (
      version integer PRIMARY KEY,
      filename varchar(255) NOT NULL,
      checksum varchar(64) NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `;
}

export async function getAppliedMigrationVersions(
  sql: postgres.Sql,
): Promise<Map<number, { filename: string; checksum: string }>> {
  await ensureMigrationLedger(sql);
  const rows = await sql<{ version: number; filename: string; checksum: string }[]>`
    SELECT version, filename, checksum
    FROM booking_requests_schema_migrations
    ORDER BY version
  `;
  return new Map(rows.map((row) => [row.version, { filename: row.filename, checksum: row.checksum }]));
}

/**
 * Apply each pending migration file once and record it in the ledger.
 *
 * Statements run auto-commit (not one big transaction) because several
 * booking-requests migrations `ALTER TYPE ... ADD VALUE` and then use the new
 * enum label in the same file — PostgreSQL requires the ADD VALUE to be
 * committed before use (55P04). SQL is written idempotently (`IF NOT EXISTS`)
 * so a mid-file failure can be retried; the ledger row is inserted only after
 * every statement in the file succeeds.
 */
export async function runPendingBookingRequestsMigrations(
  sql: postgres.Sql,
  migrationsDir: string,
): Promise<string[]> {
  const applied = await getAppliedMigrationVersions(sql);
  const files = await listMigrationFiles(migrationsDir);
  const newlyApplied: string[] = [];

  for (const file of files) {
    const body = await readFile(file.path, 'utf8');
    if (!body.trim()) continue;
    const checksum = checksumSql(body);
    const prior = applied.get(file.version);
    if (prior) {
      if (prior.checksum !== checksum) {
        throw new Error(
          `Booking-requests migration ${file.filename} checksum mismatch `
          + `(ledger=${prior.checksum}, file=${checksum})`,
        );
      }
      continue;
    }

    console.log(`Applying ${file.filename}...`);
    for (const statement of splitSqlStatements(stripLineComments(body))) {
      await sql.unsafe(statement);
    }
    await sql`
      INSERT INTO booking_requests_schema_migrations (version, filename, checksum)
      VALUES (${file.version}, ${file.filename}, ${checksum})
    `;
    newlyApplied.push(file.filename);
    console.log(`Applied ${file.filename}`);
  }

  return newlyApplied;
}

async function main() {
  const migrationsDir = resolveMigrationsDirectory();
  const client = postgres(DATABASE_URL, { max: 1 });
  try {
    const applied = await runPendingBookingRequestsMigrations(client, migrationsDir);
    if (applied.length === 0) {
      console.log('No pending booking-requests migrations.');
    } else {
      console.log(`Applied ${applied.length} booking-requests migration(s).`);
    }
  } finally {
    await client.end();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
