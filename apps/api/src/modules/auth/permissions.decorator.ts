import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'permissions';

/**
 * Require one or more permission keys (from permissions.catalog.ts) on an
 * endpoint. Enforced by PermissionsGuard. ALL listed keys are required.
 *
 * When AUTH_ENABLED=false the guard is bypassed (the demo grants everything).
 *
 * @example
 * @RequirePermissions('admin.users.manage')
 * @Post('users')
 * create() { ... }
 */
export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
