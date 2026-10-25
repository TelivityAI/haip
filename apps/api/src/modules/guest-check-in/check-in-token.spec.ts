import { describe, expect, it } from 'vitest';
import {
  defaultTokenTtlSeconds,
  maxTokenTtlSeconds,
  signCheckInToken,
  verifyCheckInToken,
} from './check-in-token';

describe('check-in-token', () => {
  const secret = 'test-secret-for-check-in';

  it('uses a 48h default TTL capped at 7 days', () => {
    expect(defaultTokenTtlSeconds()).toBe(48 * 60 * 60);
    expect(maxTokenTtlSeconds()).toBe(7 * 24 * 60 * 60);
  });

  it('round-trips a valid payload', () => {
    const payload = {
      v: 1 as const,
      reservationId: 'r1',
      propertyId: 'p1',
      exp: Math.floor(Date.now() / 1000) + 3600,
    };
    const token = signCheckInToken(payload, secret);
    expect(verifyCheckInToken(token, secret)).toEqual(payload);
  });

  it('rejects tampered tokens', () => {
    const token = signCheckInToken(
      { v: 1, reservationId: 'r1', propertyId: 'p1', exp: Math.floor(Date.now() / 1000) + 3600 },
      secret,
    );
    expect(verifyCheckInToken(token.slice(0, -2) + 'xx', secret)).toBeNull();
  });

  it('rejects expired tokens', () => {
    const token = signCheckInToken(
      { v: 1, reservationId: 'r1', propertyId: 'p1', exp: Math.floor(Date.now() / 1000) - 10 },
      secret,
    );
    expect(verifyCheckInToken(token, secret)).toBeNull();
  });
});
