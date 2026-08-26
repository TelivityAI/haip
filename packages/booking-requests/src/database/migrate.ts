import { readdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://haip:haip@localhost:5432/haip';

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

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

async function main() {
  const client = postgres(DATABASE_URL, { max: 1 });
  try {
    const files = (await readdir(migrationsDir))
      .filter((name) => name.endsWith('.sql'))
      .sort();
    for (const file of files) {
      const sql = await readFile(join(migrationsDir, file), 'utf8');
      if (!sql.trim()) continue;
      console.log(`Applying ${file}...`);
      for (const statement of splitSqlStatements(stripLineComments(sql))) {
        await client.unsafe(statement);
      }
    }
    console.log(`Applied ${files.length} booking-requests migration(s).`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
