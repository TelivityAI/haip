#!/usr/bin/env node
/**
 * Run the workspace test suite (or parse saved output) and sync counts into README.md.
 *
 * Usage:
 *   node scripts/sync-test-count.mjs              # run tests, update README
 *   node scripts/sync-test-count.mjs --check      # run tests, fail if README is stale
 *   node scripts/sync-test-count.mjs --from-output /path/to/log  # parse existing test log
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const readmePath = join(root, 'README.md');
const statsPath = join(root, 'docs', 'test-stats.json');

const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const fromOutputIdx = args.indexOf('--from-output');
const fromOutput =
  fromOutputIdx >= 0 ? readFileSync(args[fromOutputIdx + 1], 'utf8') : null;

function parseTestOutput(output) {
  let tests = 0;
  let files = 0;

  for (const line of output.split('\n')) {
    const fileMatch = line.match(/Test Files\s+(\d+) passed/);
    if (fileMatch) files += Number(fileMatch[1]);

    const testMatch = line.match(/Tests\s+(\d+) passed/);
    if (testMatch) tests += Number(testMatch[1]);
  }

  if (tests === 0 || files === 0) {
    throw new Error('Could not parse test counts from vitest output');
  }

  return { tests, files };
}

function runTests() {
  return execSync('pnpm -r run test', {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      DATABASE_URL:
        process.env.DATABASE_URL ?? 'postgresql://haip:haip@localhost:5432/haip_test',
      REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:6379',
      FORCE_COLOR: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 20 * 1024 * 1024,
  });
}

function applyCounts(readme, { tests, files }) {
  let next = readme;

  // Hero badge (shields.io)
  next = next.replace(
    /(<img src="https:\/\/img\.shields\.io\/badge\/Tests-)\d+(%20passing-brightgreen" alt=")\d+( Tests Passing" \/>)/,
    `$1${tests}$2${tests}$3`,
  );

  // Tech stack table
  next = next.replace(
    /(\| Testing \| Vitest \()\d+( tests across )\d+( test files\) \|)/,
    `$1${tests}$2${files}$3`,
  );

  // Run tests section comment
  next = next.replace(
    /(# All tests \()\d+( tests across )\d+( test files\))/,
    `$1${tests}$2${files}$3`,
  );

  // Contributing dev commands comment
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

const output = fromOutput ?? runTests();
const counts = parseTestOutput(output);

writeFileSync(
  statsPath,
  `${JSON.stringify({ ...counts, updatedAt: new Date().toISOString() }, null, 2)}\n`,
);

const readme = readFileSync(readmePath, 'utf8');
const updated = applyCounts(readme, counts);

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

if (updated === readme) {
  // First run or badge row missing — ensure badge + table exist
  if (!readme.includes('img.shields.io/badge/Tests-')) {
    throw new Error(
      'README is missing the Tests badge line. Add the badge placeholder before syncing.',
    );
  }
}

writeFileSync(readmePath, updated);
console.log(`Synced README test counts: ${counts.tests} tests across ${counts.files} files`);
