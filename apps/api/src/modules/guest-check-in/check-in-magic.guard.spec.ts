import { describe, expect, it } from 'vitest';
import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { CheckInMagicGuard } from './check-in-magic.guard';
import { signCheckInToken } from './check-in-token';

function ctx(request: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('CheckInMagicGuard', () => {
  const secret = 'guard-test-secret';
  const config = {
    get: (key: string) => {
      if (key === 'CHECK_IN_MAGIC_SECRET') return secret;
      if (key === 'NODE_ENV') return 'test';
      if (key === 'AUTH_ENABLED') return 'false';
      return undefined;
    },
  } as any;

  it('rejects missing token even when AUTH_ENABLED=false', () => {
    const guard = new CheckInMagicGuard(config);
    expect(() => guard.canActivate(ctx({ headers: {}, query: {} }))).toThrow(
      UnauthorizedException,
    );
  });

  it('accepts a valid x-check-in-token header', () => {
    const guard = new CheckInMagicGuard(config);
    const token = signCheckInToken(
      {
        v: 1,
        reservationId: 'r1',
        propertyId: 'p1',
        exp: Math.floor(Date.now() / 1000) + 3600,
      },
      secret,
    );
    const req: any = { headers: { 'x-check-in-token': token }, query: {} };
    expect(guard.canActivate(ctx(req))).toBe(true);
    expect(req.checkIn.reservationId).toBe('r1');
  });

  it('rejects expired tokens', () => {
    const guard = new CheckInMagicGuard(config);
    const token = signCheckInToken(
      {
        v: 1,
        reservationId: 'r1',
        propertyId: 'p1',
        exp: Math.floor(Date.now() / 1000) - 5,
      },
      secret,
    );
    expect(() =>
      guard.canActivate(ctx({ headers: { 'x-check-in-token': token }, query: {} })),
    ).toThrow(UnauthorizedException);
  });

  it('rejects tampered tokens', () => {
    const guard = new CheckInMagicGuard(config);
    const token = signCheckInToken(
      {
        v: 1,
        reservationId: 'r1',
        propertyId: 'p1',
        exp: Math.floor(Date.now() / 1000) + 3600,
      },
      secret,
    );
    expect(() =>
      guard.canActivate(
        ctx({ headers: { 'x-check-in-token': `${token}x` }, query: {} }),
      ),
    ).toThrow(UnauthorizedException);
  });

  it('prefers header over query string', () => {
    const guard = new CheckInMagicGuard(config);
    const good = signCheckInToken(
      {
        v: 1,
        reservationId: 'from-header',
        propertyId: 'p1',
        exp: Math.floor(Date.now() / 1000) + 3600,
      },
      secret,
    );
    const bad = signCheckInToken(
      {
        v: 1,
        reservationId: 'from-query',
        propertyId: 'p1',
        exp: Math.floor(Date.now() / 1000) + 3600,
      },
      'other-secret',
    );
    const req: any = {
      method: 'GET',
      headers: { 'x-check-in-token': good },
      query: { token: bad },
    };
    expect(guard.canActivate(ctx(req))).toBe(true);
    expect(req.checkIn.reservationId).toBe('from-header');
  });

  it('accepts query token on GET for magic-link bootstrap', () => {
    const guard = new CheckInMagicGuard(config);
    const token = signCheckInToken(
      {
        v: 1,
        reservationId: 'r1',
        propertyId: 'p1',
        exp: Math.floor(Date.now() / 1000) + 3600,
      },
      secret,
    );
    const req: any = { method: 'GET', headers: {}, query: { token } };
    expect(guard.canActivate(ctx(req))).toBe(true);
    expect(req.checkIn.reservationId).toBe('r1');
  });

  it('rejects query token on mutating POST', () => {
    const guard = new CheckInMagicGuard(config);
    const token = signCheckInToken(
      {
        v: 1,
        reservationId: 'r1',
        propertyId: 'p1',
        exp: Math.floor(Date.now() / 1000) + 3600,
      },
      secret,
    );
    expect(() =>
      guard.canActivate(ctx({ method: 'POST', headers: {}, query: { token } })),
    ).toThrow(UnauthorizedException);
  });
});
