import type { AuthUser } from './current-user.decorator';

/**
 * Platform-level roles that bypass property scoping — these operators can act
 * across tenants (e.g. support/ops). Keep in sync with the same intent in the
 * HTTP PropertyScopeGuard and the WebSocket EventsGateway.
 */
export const PLATFORM_ROLES = new Set(['admin', 'platform_admin', 'superadmin']);

/**
 * Whether an authenticated principal may act on a given property. Platform admins
 * always may; everyone else must have the property in their `property_ids` claim.
 */
export function userCanAccessProperty(user: AuthUser, propertyId: string): boolean {
  if (user.roles?.some((r) => PLATFORM_ROLES.has(r))) return true;
  return (user.propertyIds ?? []).includes(propertyId);
}
