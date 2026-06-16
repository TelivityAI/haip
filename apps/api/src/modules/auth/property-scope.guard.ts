import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AuthUser } from './current-user.decorator';
import { userCanAccessProperty } from './property-access';

/**
 * Property-scope guard — binds the authenticated principal to the `propertyId`
 * it operates on.
 *
 * Most routes are gated only by `@Roles()` (global Keycloak realm roles like
 * `front_desk`), which says *what* a user may do but not *at which property*.
 * Without this guard, any authenticated user could pass an arbitrary `propertyId`
 * (query/body/param) and reach another tenant's data — the DB queries scope by
 * that same client-supplied id. This guard enforces what the WebSocket gateway
 * already does for socket events: a non-platform user must have the property in
 * their `property_ids` claim.
 *
 * - Bypassed entirely when `AUTH_ENABLED=false` (demo).
 * - Skips `@Public()` routes (no principal to scope — e.g. inbound OTA webhooks).
 * - Skips routes that carry no `propertyId` (not property-scoped).
 * - Platform admins bypass (see `userCanAccessProperty`).
 */
@Injectable()
export class PropertyScopeGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const authEnabled = this.configService.get<string>('AUTH_ENABLED', 'true');
    if (authEnabled === 'false') {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user: AuthUser | undefined = request.user;
    // Unauthenticated routes (e.g. @Public webhooks) carry no principal to scope;
    // leave authentication of those to their own mechanism.
    if (!user) {
      return true;
    }

    const propertyId: unknown =
      request.query?.propertyId ?? request.body?.propertyId ?? request.params?.propertyId;
    // Routes without a propertyId aren't property-scoped (e.g. global admin lists,
    // /properties). Nothing to enforce here.
    if (!propertyId || typeof propertyId !== 'string') {
      return true;
    }

    if (!userCanAccessProperty(user, propertyId)) {
      throw new ForbiddenException('You do not have access to this property');
    }

    return true;
  }
}
