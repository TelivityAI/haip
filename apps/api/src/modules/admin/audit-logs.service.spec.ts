import { describe, expect, it } from 'vitest';
import { redactAuditValue } from './audit-logs.service';

describe('redactAuditValue', () => {
  it('masks credential-shaped keys at any depth', () => {
    const redacted = redactAuditValue({
      name: 'Front Desk',
      apiKey: 'sk_live_abc',
      nested: { refresh_token: 'tok', clientSecret: 'shh', visible: 'ok' },
      list: [{ password: 'pw' }],
    }) as Record<string, any>;

    expect(redacted['name']).toBe('Front Desk');
    expect(redacted['apiKey']).toBe('***redacted***');
    expect(redacted['nested']['refresh_token']).toBe('***redacted***');
    expect(redacted['nested']['clientSecret']).toBe('***redacted***');
    expect(redacted['nested']['visible']).toBe('ok');
    expect(redacted['list'][0]['password']).toBe('***redacted***');
  });

  it('leaves ordinary booking values intact', () => {
    const value = { status: 'vacant_clean', roomNumber: '110', amount: '0.00' };
    expect(redactAuditValue(value)).toEqual(value);
  });

  it('caps very long strings instead of echoing them whole', () => {
    const long = 'x'.repeat(900);
    const out = redactAuditValue({ note: long }) as Record<string, unknown>;
    expect(String(out['note']).length).toBeLessThan(600);
    expect(String(out['note']).endsWith('…')).toBe(true);
  });
});
