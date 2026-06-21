import { describe, it, expect } from 'vitest';
import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { PropertyScopeGuard } from './property-scope.guard';

function ctx(request: any): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
}

/** Build + invoke the guard with a given AUTH_ENABLED, request, and @Public flag. */
function run(authEnabled: string, request: any, isPublic = false) {
  const config = { get: (_k: string, def?: string) => (authEnabled ?? def) } as any;
  const reflector = { getAllAndOverride: () => isPublic } as any;
  const guard = new PropertyScopeGuard(reflector, config);
  return guard.canActivate(ctx(request));
}

const member = { sub: 'u1', email: 'u@x.com', name: 'U', roles: ['front_desk'], propertyIds: ['propA'] };
const admin = { sub: 'a1', email: 'a@x.com', name: 'A', roles: ['admin'], propertyIds: [] };

describe('PropertyScopeGuard', () => {
  it('bypasses entirely when AUTH_ENABLED=false', () => {
    expect(run('false', { user: member, query: { propertyId: 'propB' } })).toBe(true);
  });

  it('allows a member to access their own property', () => {
    expect(run('true', { user: member, query: { propertyId: 'propA' } })).toBe(true);
  });

  it('rejects a non-member accessing a foreign property', () => {
    expect(() => run('true', { user: member, query: { propertyId: 'propB' } })).toThrow(
      ForbiddenException,
    );
  });

  it('reads propertyId from the body when not in the query', () => {
    expect(() => run('true', { user: member, body: { propertyId: 'propB' } })).toThrow(
      ForbiddenException,
    );
  });

  it('lets platform admins cross properties', () => {
    expect(run('true', { user: admin, query: { propertyId: 'propZ' } })).toBe(true);
  });

  it('skips routes that carry no propertyId', () => {
    expect(run('true', { user: member, query: {} })).toBe(true);
  });

  it('skips @Public routes even when they carry a propertyId and no user', () => {
    expect(run('true', { query: { propertyId: 'propB' } }, /* isPublic */ true)).toBe(true);
  });

  // --- fail-closed hardening (ported from PR #116) ---

  it('FAILS CLOSED on a duplicated/array propertyId (?propertyId=A&propertyId=B)', () => {
    // member IS a member of propA, but the array form must not bypass the check.
    expect(() =>
      run('true', { user: member, query: { propertyId: ['propA', 'propB'] } }),
    ).toThrow(ForbiddenException);
  });

  it('FAILS CLOSED on a non-public route with a propertyId but no authenticated user', () => {
    expect(() => run('true', { query: { propertyId: 'propA' } })).toThrow(ForbiddenException);
  });
});
