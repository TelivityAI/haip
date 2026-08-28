import { describe, expect, it } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  checksumSql,
  listMigrationFiles,
  parseMigrationFilename,
} from './migrate.js';

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

describe('booking-requests migration runner', () => {
  it('parses numbered migration filenames', () => {
    expect(parseMigrationFilename('0022_booking_requests.sql')).toBe(22);
    expect(parseMigrationFilename('0032_booking_request_remediation.sql')).toBe(32);
    expect(parseMigrationFilename('notes.sql')).toBeNull();
  });

  it('lists package migrations in version order without duplicate versions', async () => {
    const files = await listMigrationFiles(migrationsDir);
    expect(files.length).toBeGreaterThan(0);
    const versions = files.map((f) => f.version);
    expect(versions).toEqual([...versions].sort((a, b) => a - b));
    expect(new Set(versions).size).toBe(versions.length);
  });

  it('checksums SQL bodies stably', () => {
    expect(checksumSql('SELECT 1;\n')).toBe(checksumSql('SELECT 1;\n'));
    expect(checksumSql('SELECT 1;\n')).not.toBe(checksumSql('SELECT 2;\n'));
  });
});
