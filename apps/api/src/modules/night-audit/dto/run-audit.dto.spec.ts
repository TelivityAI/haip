import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { ValidationPipe } from '@nestjs/common';
import { RunAuditDto } from './run-audit.dto';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../../');
const PROPERTY_ID = 'a0000001-0000-4000-a000-000000000001';

const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

function validate(body: Record<string, unknown>) {
  return pipe.transform(body, { type: 'body', metatype: RunAuditDto });
}

describe('scheduled night-audit callers', () => {
  it('posts mode unattended from scripts/cron/night-audit.sh', () => {
    const script = readFileSync(resolve(repoRoot, 'scripts/cron/night-audit.sh'), 'utf8');
    const body = script.match(/-d "(\{.*\})"/);
    expect(body?.[1]).toContain('\\"mode\\":\\"unattended\\"');
    expect(body?.[1]).toContain('\\"propertyId\\":\\"${HAIP_PROPERTY_ID}\\"');
    expect(body?.[1]).toContain('\\"businessDate\\":\\"${HAIP_BUSINESS_DATE}\\"');
  });

  it('every cron script that calls night-audit/run sends mode unattended', () => {
    const dir = resolve(repoRoot, 'scripts/cron');
    const callers = readdirSync(dir).filter((name) => name.endsWith('.sh'));
    const hits = callers.filter((name) => {
      const text = readFileSync(resolve(dir, name), 'utf8');
      return text.includes('night-audit/run') && !text.includes('night-audit/run-due');
    });
    expect(hits).toEqual(['night-audit.sh']);
    expect(readFileSync(resolve(dir, 'night-audit-due.sh'), 'utf8')).toContain('night-audit/run-due');
    expect(readFileSync(resolve(repoRoot, 'docs/operations/cron.md'), 'utf8')).toContain(
      '"mode": "unattended"',
    );
    for (const name of hits) {
      expect(readFileSync(resolve(dir, name), 'utf8')).toContain('\\"mode\\":\\"unattended\\"');
    }
  });
});

describe('RunAuditDto mode', () => {
  it('accepts the scheduled body and a manual body that omits mode', async () => {
    await expect(
      validate({
        propertyId: PROPERTY_ID,
        businessDate: '2026-07-01',
        mode: 'unattended',
      }),
    ).resolves.toMatchObject({ mode: 'unattended' });

    const manual = await validate({
      propertyId: PROPERTY_ID,
      businessDate: '2026-07-01',
    });
    expect(manual.mode).toBeUndefined();
  });

  it('rejects an unknown mode and still rejects unknown properties', async () => {
    await expect(
      validate({
        propertyId: PROPERTY_ID,
        businessDate: '2026-07-01',
        mode: 'auto',
      }),
    ).rejects.toMatchObject({ status: 400 });

    await expect(
      validate({
        propertyId: PROPERTY_ID,
        businessDate: '2026-07-01',
        mode: 'unattended',
        extra: true,
      }),
    ).rejects.toMatchObject({ status: 400 });
  });
});
