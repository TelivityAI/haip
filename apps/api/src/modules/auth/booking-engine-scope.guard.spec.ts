import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { BookingEngineScopeGuard } from './booking-engine-scope.guard';

function ctx(req: any) {
  return { switchToHttp: () => ({ getRequest: () => req }) } as any;
}

const A = 'aaaaaaaa-0000-4000-a000-000000000001';
const B = 'bbbbbbbb-0000-4000-b000-000000000002';

describe('BookingEngineScopeGuard', () => {
  let config: any;
  let db: any;
  let guard: BookingEngineScopeGuard;

  beforeEach(() => {
    config = { get: vi.fn().mockReturnValue('true') };
    db = {
      select: vi.fn().mockReturnValue({
        from: () => ({ where: () => Promise.resolve([]) }),
      }),
    };
    guard = new BookingEngineScopeGuard(config, db);
  });

  it('AUTH_ENABLED=false → no-op allow', async () => {
    config.get.mockReturnValue('false');
    const req: any = { bookingEngine: { propertyId: A }, query: { propertyId: B } };
    await expect(guard.canActivate(ctx(req))).resolves.toBe(true);
  });

  it('401 when BookingKeyGuard did not attach a principal', async () => {
    const req: any = { query: { propertyId: A } };
    await expect(guard.canActivate(ctx(req))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('DENIES a property-A key requesting property-B data via ?propertyId', async () => {
    const req: any = { bookingEngine: { propertyId: A }, query: { propertyId: B } };
    await expect(guard.canActivate(ctx(req))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('DENIES a property-A key POSTing to property-B via body.propertyId', async () => {
    const req: any = { bookingEngine: { propertyId: A }, body: { propertyId: B } };
    await expect(guard.canActivate(ctx(req))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('DENIES a non-string propertyId (array bypass) outright', async () => {
    const req: any = { bookingEngine: { propertyId: A }, query: { propertyId: [A, B] } };
    await expect(guard.canActivate(ctx(req))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows a property-A key requesting property-A data', async () => {
    const req: any = { bookingEngine: { propertyId: A }, query: { propertyId: A } };
    await expect(guard.canActivate(ctx(req))).resolves.toBe(true);
  });

  it('DENIES a confirmationNumber resolving to a foreign tenant', async () => {
    db.select.mockReturnValue({ from: () => ({ where: () => Promise.resolve([{ propertyId: B }]) }) });
    const req: any = { bookingEngine: { propertyId: A }, params: { confirmationNumber: 'HAIP-XYZ' } };
    await expect(guard.canActivate(ctx(req))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('DENIES an unknown confirmationNumber (no existence leak)', async () => {
    db.select.mockReturnValue({ from: () => ({ where: () => Promise.resolve([]) }) });
    const req: any = { bookingEngine: { propertyId: A }, params: { confirmationNumber: 'NOPE' } };
    await expect(guard.canActivate(ctx(req))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows a confirmationNumber resolving to the scoped tenant', async () => {
    db.select.mockReturnValue({ from: () => ({ where: () => Promise.resolve([{ propertyId: A }]) }) });
    const req: any = { bookingEngine: { propertyId: A }, params: { confirmationNumber: 'HAIP-XYZ' } };
    await expect(guard.canActivate(ctx(req))).resolves.toBe(true);
  });
});
