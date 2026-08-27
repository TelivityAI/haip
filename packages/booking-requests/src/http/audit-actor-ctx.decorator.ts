import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AuditActor } from '@telivityhaip/shared';

/**
 * Controller param decorator — builds an `AuditActor` from the authenticated
 * principal (`req.user`) and request IP. Package-local twin of apps/api's
 * `AuditActorCtx` (`apps/api/src/common/audit/audit-actor.ts`): the shared
 * `AuditActor` type + `actorFields()` helper live in `@telivityhaip/shared`,
 * but this param decorator itself reads directly off the live Express
 * request rather than any apps/api type, so it is safe to duplicate here
 * with an inline principal shape instead of importing apps/api's `AuthUser`.
 */
export const AuditActorCtx = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuditActor => {
    const req = ctx.switchToHttp().getRequest();
    const user: { sub?: string; email?: string } | undefined = req?.user;
    const fwd = req?.headers?.['x-forwarded-for'];
    const ip =
      (typeof fwd === 'string' && fwd.length > 0 ? fwd.split(',')[0]!.trim() : undefined) ??
      req?.ip ??
      req?.socket?.remoteAddress ??
      null;
    return {
      userId: user?.sub ?? null,
      userEmail: user?.email ?? null,
      ipAddress: ip,
    };
  },
);
