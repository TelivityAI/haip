import { describe, it, expect } from 'vitest';
import { HttpException, type ExecutionContext } from '@nestjs/common';
import { RateLimitGuard } from './rate-limit.guard';

function ctx(ip: string, xff?: string): ExecutionContext {
  const headers: Record<string, string> = {};
  if (xff !== undefined) headers['x-forwarded-for'] = xff;
  return {
    switchToHttp: () => ({ getRequest: () => ({ ip, headers }) }),
  } as unknown as ExecutionContext;
}

function guard(env: Record<string, string>) {
  const cfg = { get: (k: string, d?: string) => env[k] ?? d } as any;
  // Force-enable (the guard disables itself under NODE_ENV=test).
  const g = new RateLimitGuard(cfg);
  (g as any).disabled = env['DISABLED'] === 'true';
  return g;
}

describe('RateLimitGuard', () => {
  it('allows up to the limit then throws 429', () => {
    const g = guard({ RATE_LIMIT_MAX: '3', RATE_LIMIT_WINDOW_MS: '60000' });
    expect(g.canActivate(ctx('1.2.3.4'))).toBe(true);
    expect(g.canActivate(ctx('1.2.3.4'))).toBe(true);
    expect(g.canActivate(ctx('1.2.3.4'))).toBe(true);
    expect(() => g.canActivate(ctx('1.2.3.4'))).toThrow(HttpException);
  });

  it('tracks limits per client IP', () => {
    const g = guard({ RATE_LIMIT_MAX: '1' });
    expect(g.canActivate(ctx('1.1.1.1'))).toBe(true);
    expect(g.canActivate(ctx('2.2.2.2'))).toBe(true); // different IP, fresh budget
    expect(() => g.canActivate(ctx('1.1.1.1'))).toThrow(HttpException);
  });

  it('is a no-op when disabled', () => {
    const g = guard({ RATE_LIMIT_MAX: '1', DISABLED: 'true' });
    for (let i = 0; i < 10; i++) expect(g.canActivate(ctx('9.9.9.9'))).toBe(true);
  });

  it('IGNORES X-Forwarded-For by default — a rotating header cannot dodge the limit', () => {
    const g = guard({ RATE_LIMIT_MAX: '1' });
    // Same socket IP, attacker rotates XFF every request; must still be throttled.
    expect(g.canActivate(ctx('5.5.5.5', '1.1.1.1'))).toBe(true);
    expect(() => g.canActivate(ctx('5.5.5.5', '2.2.2.2'))).toThrow(HttpException);
  });

  it('honors X-Forwarded-For only when RATE_LIMIT_TRUST_PROXY=true', () => {
    const g = guard({ RATE_LIMIT_MAX: '1', RATE_LIMIT_TRUST_PROXY: 'true' });
    // Behind a trusted proxy, the forwarded client IP is the key, so distinct
    // forwarded IPs get distinct budgets.
    expect(g.canActivate(ctx('5.5.5.5', '1.1.1.1'))).toBe(true);
    expect(g.canActivate(ctx('5.5.5.5', '2.2.2.2'))).toBe(true);
  });
});
