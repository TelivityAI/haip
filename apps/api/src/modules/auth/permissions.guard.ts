import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { PERMISSIONS_KEY } from './permissions.decorator';
import { PermissionsService } from './permissions.service';
import type { AuthUser } from './current-user.decorator';

/**
 * Permission-based authorization guard (local authz).
 *
 * Augments — does not replace — RolesGuard. Runs after JwtAuthGuard has
 * populated req.user. Resolves the local user (by keycloakSub, then email),
 * loads their effective permissions for the request's propertyId, and requires
 * ALL keys listed by @RequirePermissions().
 *
 * When AUTH_ENABLED=false, the demo grants every permission (returns true) so
 * the admin console is fully browsable without Keycloak.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly configService: ConfigService,
    private readonly permissionsService: PermissionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.configService.get<string>('AUTH_ENABLED', 'true') === 'false') {
      return true;
    }

    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const authUser: AuthUser | undefined = request.user;
    if (!authUser) {
      throw new ForbiddenException('No authenticated user');
    }

    const propertyId: string | undefined =
      request.query?.propertyId ?? request.body?.propertyId;
    if (!propertyId) {
      throw new ForbiddenException('propertyId is required to resolve permissions');
    }

    const user = await this.permissionsService.findLocalUser(authUser.sub, authUser.email);
    if (!user) {
      throw new ForbiddenException('No local user account is linked to this login');
    }

    const granted = await this.permissionsService.getEffectivePermissions(
      user.id,
      propertyId,
    );
    const ok = required.every((key) => granted.includes(key));
    if (!ok) {
      throw new ForbiddenException(
        `Access denied. Required permission(s): ${required.join(', ')}`,
      );
    }
    return true;
  }
}
