import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { PropertyAccessGuard } from './property-access.guard';

function ctx(req: any) {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => req }),
  } as any;
}

const A = 'aaaaaaaa-0000-4000-a000-000000000001';
const B = 'bbbbbbbb-0000-4000-b000-000000000002';

describe('PropertyAccessGuard', () => {
  let reflector: any;
  let config: any;
  let guard: PropertyAccessGuard;

  beforeEach(() => {
    reflector = { getAllAndOverride: vi.fn().mockReturnValue(false) }; // route not @Public()
    config = { get: vi.fn().mockReturnValue('true') }; // AUTH_ENABLED=true
    guard = new PropertyAccessGuard(reflector, config);
  });

  // The headline: this is the CRITICAL #1 cross-tenant hole. Before the guard,
  // a Hotel-A token reaches Hotel-B data; this must be denied.
  it('DENIES a Hotel-A user requesting Hotel-B data via ?propertyId', () => {
    const req = { user: { sub: 'u', roles: [], propertyIds: [A] }, query: { propertyId: B } };
    expect(() => guard.canActivate(ctx(req))).toThrow(ForbiddenException);
  });

  it('allows a Hotel-A user requesting Hotel-A data', () => {
    const req = { user: { sub: 'u', roles: [], propertyIds: [A] }, query: { propertyId: A } };
    expect(guard.canActivate(ctx(req))).toBe(true);
  });

  // Path-param tenant routes (e.g. /agents/:propertyId/...) must be covered too.
  it('DENIES a Hotel-A user requesting Hotel-B data via a :propertyId path param', () => {
    const req = { user: { sub: 'u', roles: [], propertyIds: [A] }, params: { propertyId: B } };
    expect(() => guard.canActivate(ctx(req))).toThrow(ForbiddenException);
  });

  it('allows a path-param propertyId the caller is a member of', () => {
    const req = { user: { sub: 'u', roles: [], propertyIds: [A] }, params: { propertyId: A } };
    expect(guard.canActivate(ctx(req))).toBe(true);
  });

  it('denies cross-tenant via POST body, allows same-tenant via body', () => {
    const deny = { user: { sub: 'u', roles: [], propertyIds: [A] }, body: { propertyId: B } };
    expect(() => guard.canActivate(ctx(deny))).toThrow(ForbiddenException);
    const ok = { user: { sub: 'u', roles: [], propertyIds: [A] }, body: { propertyId: A } };
    expect(guard.canActivate(ctx(ok))).toBe(true);
  });

  it('lets genuine platform operators cross tenants', () => {
    const req = { user: { sub: 'a', roles: ['platform_admin'], propertyIds: [A] }, query: { propertyId: B } };
    expect(guard.canActivate(ctx(req))).toBe(true);
  });

  // `admin` is a per-hotel role, NOT a platform role — it must NOT cross tenants.
  it('does NOT let a per-property admin cross tenants', () => {
    const req = { user: { sub: 'a', roles: ['admin'], propertyIds: [A] }, query: { propertyId: B } };
    expect(() => guard.canActivate(ctx(req))).toThrow(ForbiddenException);
  });

  it('bypasses entirely when AUTH_ENABLED=false (sandbox/demo parity)', () => {
    config.get.mockReturnValue('false');
    const req = { user: undefined, query: { propertyId: B } };
    expect(guard.canActivate(ctx(req))).toBe(true);
  });

  it('allows routes that carry no propertyId (not property-scoped)', () => {
    const req = { user: { sub: 'u', roles: [], propertyIds: [A] }, query: {} };
    expect(guard.canActivate(ctx(req))).toBe(true);
  });

  it('allows @Public() routes without checking membership', () => {
    reflector.getAllAndOverride.mockReturnValue(true); // isPublic
    const req = { query: { propertyId: B } };
    expect(guard.canActivate(ctx(req))).toBe(true);
  });

  it('denies when a propertyId is present but there is no authenticated user', () => {
    const req = { query: { propertyId: A } };
    expect(() => guard.canActivate(ctx(req))).toThrow(ForbiddenException);
  });

  // Fail-closed: duplicate query params arrive as an array; an attacker must not
  // be able to slip a foreign propertyId past the check by sending two.
  it('denies an array propertyId containing a non-member tenant', () => {
    const req = { user: { sub: 'u', roles: [], propertyIds: [A] }, query: { propertyId: [A, B] } };
    expect(() => guard.canActivate(ctx(req))).toThrow(ForbiddenException);
  });

  it('allows an array propertyId where every entry is a member', () => {
    const req = { user: { sub: 'u', roles: [], propertyIds: [A, B] }, query: { propertyId: [A, B] } };
    expect(guard.canActivate(ctx(req))).toBe(true);
  });
});
