import { describe, expect, it } from 'vitest';
import {
  applyCounts,
  buildStatsDocument,
  countPassedReport,
  isReadmeOutOfDate,
  selectTestPackagePaths,
} from '../../../scripts/sync-test-count.mjs';

const COUNTS = { tests: 10, files: 2 };

function syncedReadmeFixture() {
  return [
    '<img src="https://img.shields.io/badge/License-Apache%202.0-blue" alt="Apache 2.0 License" />',
    '  <img src="https://img.shields.io/badge/Tests-10%20passing-brightgreen" alt="10 Tests Passing" />',
    '',
    '| Tool | Notes | Purpose |',
    '| --- | --- | --- |',
    '| Testing | Vitest (10 passing tests across 2 files with passing tests) | Unit and integration tests |',
    '| Build | tsup (packages) + Vite (dashboard) + nest build (API) | Fast builds |',
    '',
    '# Passing-test count: 10 test cases across 2 files (skipped excluded)',
    '',
    'pnpm test             # Run all tests (10 passing, 2 files with passes; skipped excluded)',
    '',
  ].join('\n');
}

describe('sync-test-count workspace coverage', () => {
  it('selects every non-root workspace whose manifest defines the pnpm test surface', () => {
    const manifests = new Map([
      ['/repo/apps/api', { scripts: { test: 'vitest run' } }],
      ['/repo/apps/dashboard', { scripts: { test: 'vitest run' } }],
      ['/repo/packages/database', { scripts: { test: 'vitest run' } }],
      ['/repo/packages/shared', { scripts: { test: 'vitest run' } }],
      ['/repo/packages/no-tests', { scripts: { build: 'tsup' } }],
    ]);
    const workspaces = [
      { path: '/repo' },
      ...Array.from(manifests.keys(), (path) => ({ path })),
    ];

    expect(selectTestPackagePaths(
      workspaces,
      '/repo',
      (path) => manifests.get(path),
    )).toEqual([
      '/repo/apps/api',
      '/repo/apps/dashboard',
      '/repo/packages/database',
      '/repo/packages/shared',
    ]);
  });

  it('counts passed test cases and only files with at least one passed test', () => {
    expect(countPassedReport({
      numPassedTests: 2,
      testResults: [
        { assertionResults: [{ status: 'passed' }, { status: 'skipped' }] },
        { assertionResults: [{ status: 'skipped' }] },
        { assertionResults: [] },
        { assertionResults: [{ status: 'passed' }] },
      ],
    })).toEqual({ tests: 2, files: 2 });
  });

  it('publishes the test-case count scope and skipped-test semantics explicitly', () => {
    expect(buildStatsDocument(
      { tests: 12, files: 3 },
      '2026-08-25T12:00:00.000Z',
    )).toEqual({
      tests: 12,
      files: 3,
      scope: 'all workspace packages with a test script',
      semantics: 'passed test cases and files containing at least one passed test; skipped test cases and skipped-only files are excluded',
      updatedAt: '2026-08-25T12:00:00.000Z',
    });
  });
});

describe('sync-test-count README applyCounts / --check coverage', () => {
  it('is idempotent on a fully synced README (check would pass)', () => {
    const readme = syncedReadmeFixture();
    expect(applyCounts(readme, COUNTS)).toBe(readme);
    expect(isReadmeOutOfDate(readme, COUNTS)).toBe(false);
  });

  it('fails check when the Tests badge is stale', () => {
    const stale = syncedReadmeFixture().replace(
      /Tests-10%20passing-brightgreen" alt="10 Tests Passing"/,
      'Tests-9%20passing-brightgreen" alt="9 Tests Passing"',
    );
    expect(isReadmeOutOfDate(stale, COUNTS)).toBe(true);
    expect(applyCounts(stale, COUNTS)).toContain('Tests-10%20passing');
  });

  it('fails check when the Passing-test heading is stale', () => {
    const stale = syncedReadmeFixture().replace(
      '# Passing-test count: 10 test cases across 2 files (skipped excluded)',
      '# Passing-test count: 9 test cases across 2 files (skipped excluded)',
    );
    expect(isReadmeOutOfDate(stale, COUNTS)).toBe(true);
    expect(applyCounts(stale, COUNTS)).toContain(
      '# Passing-test count: 10 test cases across 2 files (skipped excluded)',
    );
  });

  it('fails check when the pnpm test command count is stale', () => {
    const stale = syncedReadmeFixture().replace(
      'pnpm test             # Run all tests (10 passing, 2 files with passes; skipped excluded)',
      'pnpm test             # Run all tests (9 passing, 2 files with passes; skipped excluded)',
    );
    expect(isReadmeOutOfDate(stale, COUNTS)).toBe(true);
    expect(applyCounts(stale, COUNTS)).toContain(
      'pnpm test             # Run all tests (10 passing, 2 files with passes; skipped excluded)',
    );
  });

  it('fails check when Testing and Build remain concatenated on one row', () => {
    const malformed = syncedReadmeFixture().replace(
      '| Testing | Vitest (10 passing tests across 2 files with passing tests) | Unit and integration tests |\n| Build | tsup (packages) + Vite (dashboard) + nest build (API) | Fast builds |\n',
      '| Testing | Vitest (10 passing tests across 2 files with passing tests) | Unit and integration tests || Build | tsup (packages) + Vite (dashboard) + nest build (API) | Fast builds |\n',
    );
    expect(isReadmeOutOfDate(malformed, COUNTS)).toBe(true);
    const fixed = applyCounts(malformed, COUNTS);
    expect(fixed).toContain(
      '| Testing | Vitest (10 passing tests across 2 files with passing tests) | Unit and integration tests |',
    );
    expect(fixed).toContain(
      '| Build | tsup (packages) + Vite (dashboard) + nest build (API) | Fast builds |',
    );
    expect(fixed).not.toContain('tests || Build |');
  });

  it('fails check when only the Testing table row counts are stale', () => {
    const stale = syncedReadmeFixture().replace(
      'Vitest (10 passing tests across 2 files with passing tests)',
      'Vitest (9 passing tests across 2 files with passing tests)',
    );
    expect(isReadmeOutOfDate(stale, COUNTS)).toBe(true);
  });
});
