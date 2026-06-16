import type { AuthUser } from './current-user.decorator';

/**
 * Platform-level roles that bypass property scoping — these operators may act
 * across tenants for support/ops. Keep this the single source of truth so the
 * HTTP PropertyAccessGuard and the WebSocket EventsGateway never drift.
 *
 * NOTE: `admin` is intentionally NOT here. In HAIP `admin` is a per-property
 * built-in RBAC role (a hotel's own administrator), so it must remain scoped to
 * that hotel's propertyIds — only genuine platform operators cross tenants.
 */
export const PLATFORM_ROLES: ReadonlySet<string> = new Set([
  'platform_admin',
  'superadmin',
]);

/**
 * Whether `user` is allowed to act on `propertyId`.
 * - platform roles → any property,
 * - everyone else → only the properties in their `propertyIds` claim.
 * Fails closed: a user with no `propertyIds` can access nothing.
 */
export function userCanAccessProperty(user: AuthUser, propertyId: string): boolean {
  if (user.roles?.some((r) => PLATFORM_ROLES.has(r))) return true;
  return (user.propertyIds ?? []).includes(propertyId);
}
