import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';

/** Constant-time string compare (avoids leaking the key via response timing). */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * API-key guard for agent-facing endpoints (e.g. Connect API).
 *
 * Reads `x-api-key` from the request headers and validates it against the
 * comma-separated list in `CONNECT_API_KEY`. Pairs with `@Public()` on the
 * controller so JWT is skipped but the API key is still required.
 *
 * Fail-closed semantics:
 *  - When `AUTH_ENABLED !== 'false'` (prod/default) and `CONNECT_API_KEY` is
 *    missing or empty, requests are rejected with 500 rather than silently
 *    letting everyone in.
 *  - When `AUTH_ENABLED === 'false'` (dev/test), the guard is a no-op so
 *    existing dev workflows and tests are not broken.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const authEnabled = this.configService.get<string>('AUTH_ENABLED', 'true');
    if (authEnabled === 'false') {
      return true;
    }

    const configured = this.configService.get<string>('CONNECT_API_KEY');
    const validKeys = (configured ?? '')
      .split(',')
      .map((k) => k.trim())
      .filter((k) => k.length > 0);

    if (validKeys.length === 0) {
      // Fail closed — don't let requests through just because the operator
      // forgot to set a key. Matches the AUTH_ENABLED secure-by-default pattern.
      throw new InternalServerErrorException(
        'CONNECT_API_KEY is not configured — refusing to accept Connect API requests',
      );
    }

    const req = context.switchToHttp().getRequest<{ headers: Record<string, string | string[] | undefined> }>();
    const headerValue = req.headers['x-api-key'] ?? req.headers['X-API-Key' as any];
    const provided = Array.isArray(headerValue) ? headerValue[0] : headerValue;

    if (!provided || !validKeys.some((k) => safeEqual(k, provided))) {
      throw new UnauthorizedException('Invalid or missing API key');
    }

    return true;
  }
}
