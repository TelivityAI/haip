import { describe, it, expect, afterEach } from 'vitest';
import {
  formatNamedFrom,
  parseNamedFrom,
  resolvePlatformFromAddress,
  sanitizeDisplayName,
} from './email-from';

describe('email-from helpers', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('sanitizes display names that could break From headers', () => {
    expect(sanitizeDisplayName('Hotel "X" <evil>')).toBe('Hotel X evil');
  });

  it('formats named From as quoted display name plus address', () => {
    expect(formatNamedFrom('Sample Hotel', 'noreply@haip.dev')).toBe(
      '"Sample Hotel" <noreply@haip.dev>',
    );
    expect(formatNamedFrom('  ', 'noreply@haip.dev')).toBe('noreply@haip.dev');
    expect(formatNamedFrom(undefined, 'noreply@haip.dev')).toBe('noreply@haip.dev');
  });

  it('parses named and bare From addresses', () => {
    expect(parseNamedFrom('"Demo Hotel" <noreply@haip.dev>')).toEqual({
      email: 'noreply@haip.dev',
      name: 'Demo Hotel',
    });
    expect(parseNamedFrom('noreply@haip.dev')).toEqual({ email: 'noreply@haip.dev' });
  });

  it('resolves platform From from provider env vars', () => {
    delete process.env['SENDGRID_FROM'];
    delete process.env['MAILGUN_FROM'];
    delete process.env['SES_FROM'];
    delete process.env['AWS_SES_FROM'];
    delete process.env['SMTP_FROM'];
    expect(resolvePlatformFromAddress()).toBeUndefined();

    process.env['SMTP_FROM'] = 'smtp@example.com';
    expect(resolvePlatformFromAddress()).toBe('smtp@example.com');

    process.env['SENDGRID_FROM'] = 'sg@example.com';
    expect(resolvePlatformFromAddress()).toBe('sg@example.com');
  });
});
