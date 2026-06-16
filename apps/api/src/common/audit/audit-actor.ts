import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AuthUser } from '../../modules/auth/current-user.decorator';

/** Who performed an audited action + from where. All optional (null in AUTH-off demo). */
export interface AuditActor {
  userId?: string | null;
  userEmail?: string | null;
  ipAddress?: string | null;
}

/** Map an AuditActor to the auditLogs actor columns (always defined, possibly null). */
export function actorFields(actor?: AuditActor): {
  userId: string | null;
  userEmail: string | null;
  ipAddress: string | null;
} {
  return {
    userId: actor?.userId ?? null,
    userEmail: actor?.userEmail ?? null,
    ipAddress: actor?.ipAddress ?? null,
  };
}

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
