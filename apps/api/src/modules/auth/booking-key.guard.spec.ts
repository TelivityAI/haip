import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { BookingKeyGuard, hashBookingKey } from './booking-key.guard';

function ctx(req: any) {
  return { switchToHttp: () => ({ getRequest: () => req }) } as any;
}

const A = 'aaaaaaaa-0000-4000-a000-000000000001';

describe('BookingKeyGuard', () => {
  let config: any;
  let db: any;
  let guard: BookingKeyGuard;

  function dbReturning(rows: any[]) {
    return { select: () => ({ from: () => ({ where: () => Promise.resolve(rows) }) }) };
  }

  beforeEach(() => {
    config = { get: vi.fn((k: string, d?: any) => (k === 'AUTH_ENABLED' ? 'true' : d)) };
    db = dbReturning([]);
    guard = new BookingKeyGuard(config, db);
  });

  it('AUTH_ENABLED=false attaches the demo property (keyless)', async () => {
    config.get.mockImplementation((k: string, d?: any) => (k === 'AUTH_ENABLED' ? 'false' : d));
    const req: any = { headers: {} };
    await expect(guard.canActivate(ctx(req))).resolves.toBe(true);
    expect(req.bookingEngine.propertyId).toBeTruthy();
  });

  it('401 when the key is missing', async () => {
    const req: any = { headers: {} };
    await expect(guard.canActivate(ctx(req))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('resolves a valid key to a property-scoped principal', async () => {
    const raw = 'pk_live_TESTKEY';
    db = dbReturning([{ id: 'cred-1', propertyId: A, keyHash: hashBookingKey(raw), isActive: true, revokedAt: null }]);
    guard = new BookingKeyGuard(config, db);
    const req: any = { headers: { 'x-booking-key': raw } };
    await expect(guard.canActivate(ctx(req))).resolves.toBe(true);
    expect(req.bookingEngine).toEqual({ propertyId: A, credentialId: 'cred-1' });
  });

  it('TERMINAL 401 for a revoked key (never re-authorized)', async () => {
    const raw = 'pk_live_REVOKED';
    db = dbReturning([{ id: 'cred-2', propertyId: A, keyHash: hashBookingKey(raw), isActive: false, revokedAt: new Date() }]);
    guard = new BookingKeyGuard(config, db);
    const req: any = { headers: { 'x-booking-key': raw } };
    await expect(guard.canActivate(ctx(req))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('accepts the key via ?key= query param (static embed)', async () => {
    const raw = 'pk_live_VIAQUERY';
    db = dbReturning([{ id: 'cred-3', propertyId: A, keyHash: hashBookingKey(raw), isActive: true, revokedAt: null }]);
    guard = new BookingKeyGuard(config, db);
    const req: any = { headers: {}, query: { key: raw } };
    await expect(guard.canActivate(ctx(req))).resolves.toBe(true);
    expect(req.bookingEngine.propertyId).toBe(A);
  });

  it('401 when no DB is wired (fail-closed)', async () => {
    guard = new BookingKeyGuard(config, undefined);
    const req: any = { headers: { 'x-booking-key': 'pk_live_X' } };
    await expect(guard.canActivate(ctx(req))).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
