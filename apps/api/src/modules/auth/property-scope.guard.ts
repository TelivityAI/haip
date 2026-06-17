import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { IS_PUBLIC_KEY } from './public.decorator';
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
 * Fail-closed: when a non-public route carries a `propertyId`, the request MUST
 * have an authenticated member and the value MUST be a single string. A missing
 * user, or a non-scalar value (e.g. an array from a duplicated
 * `?propertyId=A&propertyId=B`), is rejected — never silently allowed.
 *
 * - Bypassed when `AUTH_ENABLED=false` (demo) or on `@Public()` routes (which
 *   authenticate by their own mechanism — health, inbound OTA webhooks, connect).
 * - Skips routes that carry no `propertyId` (not property-scoped).
 * - Platform admins bypass (see `userCanAccessProperty`).
 */
@Injectable()
export class PropertyScopeGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly configService: ConfigService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    // @Public routes authenticate by their own mechanism and may legitimately
    // carry a propertyId with no JWT user — don't fail them closed here.
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const authEnabled = this.configService.get<string>('AUTH_ENABLED', 'true');
    if (authEnabled === 'false') {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const raw: unknown =
      request.query?.propertyId ?? request.body?.propertyId ?? request.params?.propertyId;
    // Routes without a propertyId aren't property-scoped (e.g. global admin lists,
    // /properties). Nothing to enforce here.
    if (raw === undefined || raw === null) {
      return true;
    }

    const user: AuthUser | undefined = request.user;
    if (!user) {
      throw new ForbiddenException('No authenticated user');
    }
    // A duplicated query param (`?propertyId=A&propertyId=B`) parses to an array;
    // reject anything non-scalar rather than skipping the membership check.
    if (typeof raw !== 'string') {
      throw new ForbiddenException('Invalid propertyId');
    }
    if (!userCanAccessProperty(user, raw)) {
      throw new ForbiddenException('You do not have access to this property');
    }

    return true;
  }
}
