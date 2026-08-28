import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AuditActor } from '@telivityhaip/shared';
import type { AuthUser } from '../../modules/auth/current-user.decorator';

/**
 * Canonical definitions live in @telivityhaip/shared so
 * @telivityhaip/booking-requests can use the same actor shape without
 * importing apps/api.
 */
export { type AuditActor, actorFields } from '@telivityhaip/shared';

/**
 * Controller param decorator — builds an AuditActor from the authenticated
 * principal (req.user) and request IP. Undefined fields when auth is off so the
 * audit row records nulls rather than forging an actor from client input.
 */
export const AuditActorCtx = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuditActor => {
    const req = ctx.switchToHttp().getRequest();
    const user: AuthUser | undefined = req?.user;
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
