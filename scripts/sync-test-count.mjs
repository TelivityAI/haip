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
import { spawnSync } from 'node:child_process';
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

/** Strip ANSI color/spinner codes (common in CI logs). */
function stripAnsi(text) {
  return text.replace(/\u001b\[[0-9;]*m/g, '').replace(/\r/g, '');
}

function parseTestOutput(output) {
  const text = stripAnsi(output);
  let tests = 0;
  let files = 0;

  for (const line of text.split('\n')) {
    const fileMatch = line.match(/Test Files\s+(\d+)\s+passed/);
    if (fileMatch) files += Number(fileMatch[1]);

    const testMatch = line.match(/Tests\s+(\d+)\s+passed/);
    if (testMatch) tests += Number(testMatch[1]);
  }

  // Fallback: scan the full log (pnpm prefixes / wrapped lines can break per-line parsing).
  if (files === 0) {
    for (const match of text.matchAll(/Test Files\s+(\d+)\s+passed/g)) {
      files += Number(match[1]);
    }
  }
  if (tests === 0) {
    for (const match of text.matchAll(/Tests\s+(\d+)\s+passed/g)) {
      tests += Number(match[1]);
    }
  }

  if (tests === 0 || files === 0) {
    const hint = fromOutput
      ? `Log size: ${output.length} bytes. Tail:\n${text.slice(-2000)}`
      : 'Re-run with --from-output to inspect the captured log.';
    throw new Error(`Could not parse test counts from vitest output.\n${hint}`);
  }

  return { tests, files };
}

function runTests() {
  const env = {
    ...process.env,
    DATABASE_URL:
      process.env.DATABASE_URL ?? 'postgresql://haip:haip@localhost:5432/haip_test',
    REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:6379',
    FORCE_COLOR: '0',
  };

  const result = spawnSync('pnpm', ['-r', 'run', 'test'], {
    cwd: root,
    env,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });

  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  if (result.status !== 0) {
    process.stdout.write(output);
    process.exit(result.status ?? 1);
  }
  return output;
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
