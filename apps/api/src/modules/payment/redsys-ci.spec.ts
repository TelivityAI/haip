import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Redsys PostgreSQL regression gate', () => {
  it.each(['ci.yml', 'release.yml'])('runs the callback suite against the disposable database in %s', (workflow) => {
    const source = readFileSync(resolve(process.cwd(), '../../.github/workflows', workflow), 'utf8');
    const tests = source.split(/\n {6}- name:/).find((step) => /Run tests/.test(step));
    expect(tests).toMatch(/REDSYS_TEST_DATABASE_URL: postgresql:\/\/haip:haip@localhost:5432\/haip_test/);
    expect(source).toMatch(/POSTGRES_DB: haip_test/);
  });
});
