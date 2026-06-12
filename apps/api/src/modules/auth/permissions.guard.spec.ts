import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { PermissionsGuard } from './permissions.guard';

function ctx(req: any) {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => req }),
  } as any;
}

describe('PermissionsGuard', () => {
  let reflector: any;
  let config: any;
  let permissions: any;
  let guard: PermissionsGuard;

  beforeEach(() => {
    reflector = { getAllAndOverride: vi.fn() };
    config = { get: vi.fn().mockReturnValue('true') }; // AUTH_ENABLED=true
    permissions = {
      findLocalUser: vi.fn(),
      getEffectivePermissions: vi.fn(),
    };
    guard = new PermissionsGuard(reflector, config, permissions);
  });

  it('bypasses everything when AUTH_ENABLED=false', async () => {
    config.get.mockReturnValue('false');
    reflector.getAllAndOverride.mockReturnValue(['admin.users.manage']);
    await expect(guard.canActivate(ctx({}))).resolves.toBe(true);
    expect(permissions.findLocalUser).not.toHaveBeenCalled();
  });

  it('allows when no @RequirePermissions metadata is present', async () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    await expect(guard.canActivate(ctx({ user: { sub: 's' } }))).resolves.toBe(true);
  });

  it('allows when the local user has all required permissions', async () => {
    reflector.getAllAndOverride.mockReturnValue(['admin.users.manage']);
    permissions.findLocalUser.mockResolvedValue({ id: 'u1' });
    permissions.getEffectivePermissions.mockResolvedValue(['admin.users.manage', 'rooms.read']);
    const req = { user: { sub: 'kc-1', email: 'a@b.com' }, query: { propertyId: 'p1' } };
    await expect(guard.canActivate(ctx(req))).resolves.toBe(true);
    expect(permissions.findLocalUser).toHaveBeenCalledWith('kc-1', 'a@b.com');
    expect(permissions.getEffectivePermissions).toHaveBeenCalledWith('u1', 'p1');
  });

  it('forbids when a required permission is missing', async () => {
    reflector.getAllAndOverride.mockReturnValue(['admin.roles.manage']);
    permissions.findLocalUser.mockResolvedValue({ id: 'u1' });
    permissions.getEffectivePermissions.mockResolvedValue(['rooms.read']);
    const req = { user: { sub: 'kc-1' }, query: { propertyId: 'p1' } };
    await expect(guard.canActivate(ctx(req))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('forbids when there is no authenticated user', async () => {
    reflector.getAllAndOverride.mockReturnValue(['admin.users.manage']);
    await expect(guard.canActivate(ctx({ query: { propertyId: 'p1' } }))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('forbids when no local user is linked to the login', async () => {
    reflector.getAllAndOverride.mockReturnValue(['admin.users.manage']);
    permissions.findLocalUser.mockResolvedValue(null);
    const req = { user: { sub: 'kc-x' }, query: { propertyId: 'p1' } };
    await expect(guard.canActivate(ctx(req))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('forbids when propertyId is absent (cannot resolve scope)', async () => {
    reflector.getAllAndOverride.mockReturnValue(['admin.users.manage']);
    const req = { user: { sub: 'kc-1' }, query: {} };
    await expect(guard.canActivate(ctx(req))).rejects.toBeInstanceOf(ForbiddenException);
  });
});
