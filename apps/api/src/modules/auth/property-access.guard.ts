import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { IS_PUBLIC_KEY } from './public.decorator';
import { userCanAccessProperty } from './property-access.util';
import type { AuthUser } from './current-user.decorator';

/**
 * Global tenant-isolation guard.
 *
 * Runs after JwtAuthGuard (which populates req.user). For any request that
 * carries a `propertyId` (path param e.g. /agents/:propertyId, query param, or
 * request body — the three conventions across the API), it enforces that the
 * authenticated caller is a member of that property
 * (or a platform admin). Without this, every property-scoped route is scoped
 * only by the *attacker-supplied* propertyId — a cross-tenant data leak.
 *
 * Deliberately implicit: it keys off the presence of `propertyId` rather than a
 * per-route decorator, so it covers every scoped route at once and cannot be
 * forgotten on a new controller. Routes that legitimately have no propertyId
 * (auth/me, property list/create, guest walk-in create, health) are not gated
 * here; @Public() routes (health, connect/*, webhooks) are skipped outright.
 *
 * Mirrors the WebSocket EventsGateway membership check via the shared
 * userCanAccessProperty() helper. Honors AUTH_ENABLED=false like the other
 * guards so the sandbox/demo keeps working.
 */
@Injectable()
export class PropertyAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly configService: ConfigService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    if (this.configService.get<string>('AUTH_ENABLED', 'true') === 'false') {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const raw: unknown =
      request.params?.propertyId ??
      request.query?.propertyId ??
      request.body?.propertyId;

    // No propertyId → this route isn't property-scoped; nothing to enforce here.
    if (raw === undefined || raw === null) return true;

    const user: AuthUser | undefined = request.user;
    if (!user) {
      throw new ForbiddenException('No authenticated user');
    }

    // Fail closed: a propertyId is present, so it MUST resolve to string(s) the
    // caller is a member of. Arrays (?propertyId=A&propertyId=B) must ALL pass —
    // never let a non-string value slip through unchecked.
    const ids = Array.isArray(raw) ? raw : [raw];
    for (const pid of ids) {
      if (typeof pid !== 'string' || !userCanAccessProperty(user, pid)) {
        throw new ForbiddenException('Not a member of this property');
      }
    }
    return true;
  }
}
