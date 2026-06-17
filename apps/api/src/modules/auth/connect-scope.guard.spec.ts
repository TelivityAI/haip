import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { ConnectScopeGuard } from './connect-scope.guard';

function ctx(req: any) {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as any;
}

const A = 'aaaaaaaa-0000-4000-a000-000000000001';
const B = 'bbbbbbbb-0000-4000-b000-000000000002';

describe('ConnectScopeGuard', () => {
  let config: any;
  let db: any;
  let guard: ConnectScopeGuard;

  beforeEach(() => {
    config = { get: vi.fn().mockReturnValue('true') };
    db = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      }),
    };
    guard = new ConnectScopeGuard(config, db);
  });

  it('AUTH_ENABLED=false → no-op allow', async () => {
    config.get.mockReturnValue('false');
    const req: any = { connect: { scope: 'property', propertyId: A }, query: { propertyId: B } };
    await expect(guard.canActivate(ctx(req))).resolves.toBe(true);
  });

  it('platform scope bypasses all checks', async () => {
    const req: any = { connect: { scope: 'platform' }, query: { propertyId: B }, params: { id: B } };
    await expect(guard.canActivate(ctx(req))).resolves.toBe(true);
  });

  it('throws 401 when ApiKeyGuard did not attach a principal', async () => {
    const req: any = { query: { propertyId: A } };
    await expect(guard.canActivate(ctx(req))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  // The headline cross-tenant denial: a property-A credential MUST NOT touch B.
  it('DENIES a tenant-A credential requesting tenant-B data via ?propertyId', async () => {
    const req: any = { connect: { scope: 'property', propertyId: A }, query: { propertyId: B } };
    await expect(guard.canActivate(ctx(req))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows a tenant-A credential requesting tenant-A data', async () => {
    const req: any = { connect: { scope: 'property', propertyId: A }, query: { propertyId: A } };
    await expect(guard.canActivate(ctx(req))).resolves.toBe(true);
  });

  it('DENIES a tenant-A credential POSTing to tenant-B via body.propertyId', async () => {
    const req: any = { connect: { scope: 'property', propertyId: A }, body: { propertyId: B } };
    await expect(guard.canActivate(ctx(req))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('DENIES non-string propertyId (array bypass) outright', async () => {
    const req: any = { connect: { scope: 'property', propertyId: A }, query: { propertyId: [A, B] } };
    await expect(guard.canActivate(ctx(req))).rejects.toBeInstanceOf(ForbiddenException);
  });

  // The guard intentionally does NOT enforce `params.id` (it would over-deny on
  // /subscriptions/:id where `:id` is a subscription UUID, not a propertyId).
  // The /connect/properties/:id check lives in the controller method instead.
  it('does NOT block on params.id alone — subscription :id is allowed through', async () => {
    const subscriptionId = 'cccccccc-0000-4000-c000-000000000003';
    const req: any = {
      connect: { scope: 'property', propertyId: A },
      params: { id: subscriptionId },
      query: { propertyId: A },
    };
    await expect(guard.canActivate(ctx(req))).resolves.toBe(true);
  });

  it('DENIES a confirmationNumber that resolves to a foreign tenant', async () => {
    db.select.mockReturnValue({
      from: () => ({ where: () => Promise.resolve([{ propertyId: B }]) }),
    });
    const req: any = { connect: { scope: 'property', propertyId: A }, params: { confirmationNumber: 'HAIP-XYZ' } };
    await expect(guard.canActivate(ctx(req))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows a confirmationNumber that resolves to the scoped tenant', async () => {
    db.select.mockReturnValue({
      from: () => ({ where: () => Promise.resolve([{ propertyId: A }]) }),
    });
    const req: any = { connect: { scope: 'property', propertyId: A }, params: { confirmationNumber: 'HAIP-XYZ' } };
    await expect(guard.canActivate(ctx(req))).resolves.toBe(true);
  });

  it('DENIES an unknown confirmationNumber (no leak via existence)', async () => {
    db.select.mockReturnValue({
      from: () => ({ where: () => Promise.resolve([]) }),
    });
    const req: any = { connect: { scope: 'property', propertyId: A }, params: { confirmationNumber: 'NOPE' } };
    await expect(guard.canActivate(ctx(req))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows routes that carry no scoping inputs at all (controller will use principal.propertyId)', async () => {
    const req: any = { connect: { scope: 'property', propertyId: A } };
    await expect(guard.canActivate(ctx(req))).resolves.toBe(true);
  });
});
