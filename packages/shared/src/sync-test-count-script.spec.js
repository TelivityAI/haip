import { describe, expect, it } from 'vitest';
import {
  buildStatsDocument,
  countPassedReport,
  selectTestPackagePaths,
} from '../../../scripts/sync-test-count.mjs';

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
