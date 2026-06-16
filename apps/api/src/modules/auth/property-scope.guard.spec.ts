import { describe, it, expect } from 'vitest';
import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { PropertyScopeGuard } from './property-scope.guard';

function ctx(request: any): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function guardWith(authEnabled: string) {
  const config = { get: (_k: string, def?: string) => (authEnabled ?? def) } as any;
  return new PropertyScopeGuard(config);
}

const member = { sub: 'u1', email: 'u@x.com', name: 'U', roles: ['front_desk'], propertyIds: ['propA'] };
const admin = { sub: 'a1', email: 'a@x.com', name: 'A', roles: ['admin'], propertyIds: [] };

describe('PropertyScopeGuard', () => {
  it('bypasses entirely when AUTH_ENABLED=false', () => {
    const guard = guardWith('false');
    // foreign property, but auth off → allowed (demo)
    expect(guard.canActivate(ctx({ user: member, query: { propertyId: 'propB' } }))).toBe(true);
  });

  it('allows a member to access their own property', () => {
    const guard = guardWith('true');
    expect(guard.canActivate(ctx({ user: member, query: { propertyId: 'propA' } }))).toBe(true);
  });

  it('rejects a non-member accessing a foreign property', () => {
    const guard = guardWith('true');
    expect(() => guard.canActivate(ctx({ user: member, query: { propertyId: 'propB' } }))).toThrow(
      ForbiddenException,
    );
  });

  it('reads propertyId from the body when not in the query', () => {
    const guard = guardWith('true');
    expect(() => guard.canActivate(ctx({ user: member, body: { propertyId: 'propB' } }))).toThrow(
      ForbiddenException,
    );
  });

  it('lets platform admins cross properties', () => {
    const guard = guardWith('true');
    expect(guard.canActivate(ctx({ user: admin, query: { propertyId: 'propZ' } }))).toBe(true);
  });

  it('skips routes that carry no propertyId', () => {
    const guard = guardWith('true');
    expect(guard.canActivate(ctx({ user: member, query: {} }))).toBe(true);
  });

  it('skips @Public routes that have no authenticated user', () => {
    const guard = guardWith('true');
    expect(guard.canActivate(ctx({ query: { propertyId: 'propB' } }))).toBe(true);
  });
});
