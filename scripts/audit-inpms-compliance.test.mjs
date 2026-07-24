// Modified by inHotel Sàrl for inPMS; see NOTICE for upstream provenance.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { auditRepository } from './audit-inpms-compliance.mjs';

const root = new URL('../', import.meta.url);
const read = (name) => readFileSync(new URL(name, root), 'utf8');
const readJson = (name) => JSON.parse(read(name));

test('repository has complete licensing provenance files', () => {
  assert.equal(existsSync(new URL('LICENSE', root)), true);
  assert.equal(existsSync(new URL('NOTICE', root)), true);
  assert.equal(existsSync(new URL('THIRD_PARTY_LICENSES', root)), true);

  const notice = read('NOTICE');
  const license = read('LICENSE');

  assert.match(notice, /inHotel Sàrl/);
  assert.match(notice, /TelivityAI\/haip/);
  assert.match(notice, /Apache License, Version 2\.0/);
  assert.match(license, /Copyright 2026 Telivity/);
});

test('workspace packages use the inHotel namespace', () => {
  const expected = {
    'package.json': '@inhotel-io/inpms',
    'apps/api/package.json': '@inhotel-io/api',
    'apps/booking/package.json': '@inhotel-io/booking',
    'apps/dashboard/package.json': '@inhotel-io/dashboard',
    'packages/database/package.json': '@inhotel-io/database',
    'packages/shared/package.json': '@inhotel-io/shared',
    'tools/haip-connect-gpt/package.json': '@inhotel-io/connect-gpt',
    'tools/mock-bookingcom/package.json': '@inhotel-io/mock-bookingcom',
    'tools/mock-derbysoft/package.json': '@inhotel-io/mock-derbysoft',
    'tools/mock-siteminder/package.json': '@inhotel-io/mock-siteminder',
  };

  for (const [file, packageName] of Object.entries(expected)) {
    assert.equal(readJson(file).name, packageName, file);
  }

  const packageText = Object.keys(expected).map(read).join('\n');
  assert.doesNotMatch(packageText, /@telivityhaip|"name":\s*"haip"/);
});

test('primary user-facing documentation uses inPMS branding', () => {
  const files = [
    'README.md',
    'AGENTS.md',
    'CLAUDE.md',
    'apps/api/public/index.html',
    'apps/booking/README.md',
    'tools/haip-connect-gpt/README.md',
    'tools/haip-connect-gpt/CHATGPT-GPT.md',
    'prompts/FIRST_SESSION_BOOTSTRAP.md',
  ];

  const allowed = {
    'README.md': ['TelivityAI/haip', 'telivityai/haip', 'HAIP_', 'hf.co/telivity/haip-ai', 'tools/haip-connect-gpt', 'haip/', 'haip-connect-gpt'],
    'AGENTS.md': ['HAIP_', 'haip'],
    'CLAUDE.md': ['HAIP_KNOWLEDGE_BASE'],
    'apps/api/public/index.html': ['TelivityAI/haip'],
    'apps/booking/index.html': ['haip-booking'],
    'apps/booking/README.md': ['HAIP_', 'HAIPDEMO', 'haip-booking'],
    'apps/dashboard/index.html': ['telivity-'],
    'apps/dashboard/public/booking-preview.html': ['haip-', 'haip_', 'HAIPDEMO'],
    'tools/haip-connect-gpt/README.md': ['HAIP_', 'haip_', 'haip-', 'haip-connect-gpt'],
    'tools/haip-connect-gpt/CHATGPT-GPT.md': ['HAIP_', 'haip_', 'haip-connect-gpt'],
    'prompts/FIRST_SESSION_BOOTSTRAP.md': ['HAIP_BUILD_PLAN', 'HAIP_KNOWLEDGE_BASE', 'haip-'],
  };

  for (const file of files) {
    const matches = read(file).split(/\r?\n/).filter((line) => /HAIP|Telivity|telivityhaip/i.test(line));
    assert.deepEqual(matches.filter((line) => !(allowed[file] ?? []).some((pattern) => line.includes(pattern))), [], file);
  }
});

test('compliance auditor passes the repository and reports model/dependency surfaces', () => {
  const report = auditRepository(new URL('../', import.meta.url).pathname);
  assert.equal(report.ok, true, report.errors.join('\n'));
  assert.ok(Array.isArray(report.dependencyLicenses));
  assert.ok(Array.isArray(report.modelArtifacts));
});

test('compliance auditor fails a repository with missing provenance and stale unclassified branding', () => {
  const fixture = mkdtempSync('/tmp/inpms-compliance-fixture-');
  try {
    mkdirSync(join(fixture, 'scripts'), { recursive: true });
    writeFileSync(join(fixture, 'scripts', 'inpms-compliance-allowlist.json'), JSON.stringify({ entries: [] }));
    writeFileSync(join(fixture, 'package.json'), JSON.stringify({ name: '@inhotel-io/inpms' }));
    writeFileSync(join(fixture, 'README.md'), 'This is HAIP and has no provenance.\n');
    const report = auditRepository(fixture);
    assert.equal(report.ok, false);
    assert.ok(report.errors.some((error) => error.includes('Missing required legal file')));
    assert.ok(report.errors.some((error) => error.includes('Unclassified legacy branding')));
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
