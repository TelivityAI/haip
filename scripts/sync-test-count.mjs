#!/usr/bin/env node
/**
 * Run the workspace test suite and sync counts into README.md.
 *
 * Usage:
 *   node scripts/sync-test-count.mjs              # run tests, update README
 *   node scripts/sync-test-count.mjs --check      # run tests, fail if README is stale
 *
 * Counts come from vitest's JSON reporter (reliable in CI; no log parsing).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const readmePath = join(root, 'README.md');
const statsPath = join(root, 'docs/test-stats.json');
const countDir = join(root, '.vitest-count');

/** Packages that ship vitest suites (matches `pnpm -r run test` contributors). */
const TEST_PACKAGES = ['apps/api', 'apps/dashboard', 'apps/booking'];

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

function runTestsAndCollectCounts() {
  mkdirSync(countDir, { recursive: true });
  const env = testEnv();
  let tests = 0;
  let files = 0;

  for (const pkg of TEST_PACKAGES) {
    const cwd = join(root, pkg);
    const outFile = join(countDir, `${pkg.replace('/', '-')}.json`);

    const result = spawnSync(
      'pnpm',
      ['exec', 'vitest', 'run', '--reporter=json', `--outputFile=${outFile}`],
      { cwd, env, encoding: 'utf8' },
    );

    const log = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    if (log.trim()) process.stdout.write(log);

    if (result.status !== 0) {
      process.exit(result.status ?? 1);
    }

    if (!existsSync(outFile)) {
      continue;
    }

    const report = JSON.parse(readFileSync(outFile, 'utf8'));
    tests += report.numPassedTests ?? 0;
    files += countPassedFiles(report);
  }

  if (tests === 0 || files === 0) {
    throw new Error('No vitest results found — could not determine test counts');
  }

  return { tests, files };
}

function applyCounts(readme, { tests, files }) {
  let next = readme;

  next = next.replace(
    /(<img src="https:\/\/img\.shields\.io\/badge\/Tests-)\d+(%20passing-brightgreen" alt=")\d+( Tests Passing" \/>)/,
    `$1${tests}$2${tests}$3`,
  );

  next = next.replace(
    /(\| Testing \| Vitest \()\d+( tests across )\d+( test files\) \|)/,
    `$1${tests}$2${files}$3`,
  );

  next = next.replace(
    /(# All tests \()\d+( tests across )\d+( test files\))/,
    `$1${tests}$2${files}$3`,
  );

  next = next.replace(
    /(pnpm test\s+# Run all tests \()\d+( tests, )\d+( files\))/,
    `$1${tests}$2${files}$3`,
  );

  return next;
}

function readCountsFromReadme(readme) {
  const testsMatch = readme.match(
    /\| Testing \| Vitest \((\d+) tests across (\d+) test files\) \|/,
  );
  if (!testsMatch) {
    throw new Error('README is missing the Vitest test-count row (run sync once to add markers)');
  }
  return { tests: Number(testsMatch[1]), files: Number(testsMatch[2]) };
}

const counts = runTestsAndCollectCounts();
const readme = readFileSync(readmePath, 'utf8');

if (checkOnly) {
  const current = readCountsFromReadme(readme);
  if (current.tests !== counts.tests || current.files !== counts.files) {
    console.error(
      `README test counts are stale (readme: ${current.tests} tests / ${current.files} files, actual: ${counts.tests} / ${counts.files}).`,
    );
    console.error('Run: pnpm readme:sync-tests');
    process.exit(1);
  }
  console.log(`README test counts OK (${counts.tests} tests, ${counts.files} files)`);
  process.exit(0);
}

writeFileSync(
  statsPath,
  `${JSON.stringify({ ...counts, updatedAt: new Date().toISOString() }, null, 2)}\n`,
);

const updated = applyCounts(readme, counts);

if (updated === readme && !readme.includes('img.shields.io/badge/Tests-')) {
  throw new Error('README is missing the Tests badge line. Add the badge placeholder before syncing.');
}

writeFileSync(readmePath, updated);
console.log(`Synced README test counts: ${counts.tests} tests across ${counts.files} files`);
