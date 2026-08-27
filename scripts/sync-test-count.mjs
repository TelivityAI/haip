#!/usr/bin/env node
/**
 * Run the complete workspace test suite and sync passed counts into README.md
 * and docs/test-stats.json. Skipped test cases and skipped-only files do not
 * inflate the published totals.
 *
 * Usage:
 *   node scripts/sync-test-count.mjs              # run tests, update README
 *   node scripts/sync-test-count.mjs --check      # run tests, fail if published counts are stale
 *
 * Counts come from vitest's JSON reporter (reliable in CI; no log parsing).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const readmePath = join(root, 'README.md');
const statsPath = join(root, 'docs/test-stats.json');
const countDir = join(root, '.vitest-count');

const args = process.argv.slice(2);
const checkOnly = args.includes('--check');

function testEnv() {
  return {
    ...process.env,
    DATABASE_URL:
      process.env.DATABASE_URL ?? 'postgresql://haip:haip@localhost:5432/haip_test',
    REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:6379',
    FORCE_COLOR: '0',
  };
}

function countPassedFiles(report) {
  return report.testResults.filter((file) => {
    const tests = file.assertionResults ?? [];
    return tests.some((t) => t.status === 'passed');
  }).length;
}

export function countPassedReport(report) {
  return {
    tests: report.numPassedTests ?? 0,
    files: countPassedFiles(report),
  };
}

export function buildStatsDocument(counts, updatedAt = new Date().toISOString()) {
  return {
    ...counts,
    scope: 'all workspace packages with a test script',
    semantics:
      'passed test cases and files containing at least one passed test; skipped test cases and skipped-only files are excluded',
    updatedAt,
  };
}

export function selectTestPackagePaths(
  workspaces,
  workspaceRoot = root,
  readManifest = (path) => JSON.parse(readFileSync(join(path, 'package.json'), 'utf8')),
) {
  return workspaces
    .map((workspace) => workspace.path)
    .filter((path) => resolve(path) !== resolve(workspaceRoot))
    .filter((path) => Boolean(readManifest(path)?.scripts?.test));
}

function discoverTestPackagePaths() {
  const result = spawnSync(
    'pnpm',
    ['-r', 'list', '--depth', '-1', '--json'],
    { cwd: root, env: testEnv(), encoding: 'utf8' },
  );
  if (result.status !== 0) {
    throw new Error(
      `Could not discover pnpm test workspaces: ${result.stderr || result.stdout || 'unknown error'}`,
    );
  }
  return selectTestPackagePaths(JSON.parse(result.stdout));
}

function runTestsAndCollectCounts() {
  mkdirSync(countDir, { recursive: true });
  const env = testEnv();
  let tests = 0;
  let files = 0;

  for (const cwd of discoverTestPackagePaths()) {
    const workspacePath = relative(root, cwd);
    const outFile = join(countDir, `${workspacePath.replaceAll(/[\\/]/g, '-')}.json`);

    const result = spawnSync(
      'pnpm',
      ['exec', 'vitest', 'run', '--reporter=json', `--outputFile=${outFile}`],
      { cwd, env, encoding: 'utf8' },
    );

    const log = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    if (log.trim()) process.stdout.write(log);

    if (result.status !== 0) {
      throw new Error(`Tests failed in ${workspacePath}`);
    }

    if (!existsSync(outFile)) {
      continue;
    }

    const report = JSON.parse(readFileSync(outFile, 'utf8'));
    const count = countPassedReport(report);
    tests += count.tests;
    files += count.files;
  }

  if (tests === 0 || files === 0) {
    throw new Error('No vitest results found — could not determine test counts');
  }

  return { tests, files };
}

/**
 * Rewrite every README location owned by this synchronizer (badge, Testing
 * table row, malformed-row normalization, heading, and `pnpm test` command).
 */
export function applyCounts(readme, { tests, files }) {
  let next = readme;

  if (!next.includes('img.shields.io/badge/Tests-')) {
    next = next.replace(
      /(<img src="https:\/\/img\.shields\.io\/badge\/License-Apache%202\.0-blue" alt="Apache 2\.0 License" \/>)/,
      `$1\n  <img src="https://img.shields.io/badge/Tests-${tests}%20passing-brightgreen" alt="${tests} Tests Passing" />`,
    );
  } else {
    next = next.replace(
      /(<img src="https:\/\/img\.shields\.io\/badge\/Tests-)\d+(%20passing-brightgreen" alt=")\d+( Tests Passing" \/>)/,
      `$1${tests}$2${tests}$3`,
    );
  }

  // Normalize legacy rows where Testing and Build were concatenated on one line.
  next = next.replace(
    /\| Testing \| Vitest \([^|]+\) \| Unit and integration tests \|\| Build \|[^|\n]+\|[^\n]*\n/,
    `| Testing | Vitest (${tests} passing tests across ${files} files with passing tests) | Unit and integration tests |\n| Build | tsup (packages) + Vite (dashboard) + nest build (API) | Fast builds |\n`,
  );

  next = next.replace(
    /\| Testing \| Vitest \([^|]+\) \| Unit and integration tests \|/,
    `| Testing | Vitest (${tests} passing tests across ${files} files with passing tests) | Unit and integration tests |`,
  );

  next = next.replace(
    /(?:# All tests|# Passing-test count:)[^\n]*/,
    `# Passing-test count: ${tests} test cases across ${files} files (skipped excluded)`,
  );

  next = next.replace(
    /pnpm test\s+# Run all tests[^\n]*/,
    `pnpm test             # Run all tests (${tests} passing, ${files} files with passes; skipped excluded)`,
  );

  return next;
}

/** True when any synchronizer-owned README location differs from applyCounts output. */
export function isReadmeOutOfDate(readme, counts) {
  return applyCounts(readme, counts) !== readme;
}

function main() {
  const counts = runTestsAndCollectCounts();
  const readme = readFileSync(readmePath, 'utf8');

  if (checkOnly) {
    const stats = JSON.parse(readFileSync(statsPath, 'utf8'));
    const expectedStats = buildStatsDocument(counts, stats.updatedAt);
    const readmeStale = isReadmeOutOfDate(readme, counts);
    const statsStale = JSON.stringify(stats) !== JSON.stringify(expectedStats);
    if (readmeStale || statsStale) {
      throw new Error(
        `Published test counts are stale (actual: ${counts.tests} / ${counts.files}). Run: pnpm readme:sync-tests`,
      );
    }
    console.log(`Published test counts OK (${counts.tests} tests, ${counts.files} files)`);
    return;
  }

  writeFileSync(
    statsPath,
    `${JSON.stringify(buildStatsDocument(counts), null, 2)}\n`,
  );

  writeFileSync(readmePath, applyCounts(readme, counts));
  console.log(`Synced README test counts: ${counts.tests} tests across ${counts.files} files`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
