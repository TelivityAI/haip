import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * Extract the authenticated user from the request.
 * Populated by JwtStrategy from the JWT claims (Keycloak or generic OIDC).
 *
 * @example
 * @Get('profile')
 * getProfile(@CurrentUser() user: AuthUser) {
 *   return { email: user.email, roles: user.roles };
 * }
 */
export const CurrentUser = createParamDecorator(
  (data: string | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user;
    return data ? user?.[data] : user;
  },
);

export interface AuthUser {
  sub: string;          // IdP subject (Keycloak UUID, Zitadel numeric id, …)
  email: string;
  name: string;
  roles: string[];      // realm_access.roles, Zitadel project roles or `roles`
  propertyIds?: string[]; // property_ids claim, or `property:<uuid>` roles
}
