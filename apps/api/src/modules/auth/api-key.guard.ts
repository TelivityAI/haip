import {
  Injectable,
  Inject,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, timingSafeEqual } from 'node:crypto';
import { eq, and } from 'drizzle-orm';
import { connectCredentials } from '@telivityhaip/database';
import { DRIZZLE } from '../../database/database.module';

/** Constant-time string compare (avoids leaking the key via response timing). */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** sha256(rawKey) → 64-char hex digest (matches `connect_credentials.key_hash`). */
export function hashConnectKey(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/**
 * Authenticated principal attached to the request by the Connect API key guard.
 *
 * - `scope='property'`: a tenant-bound credential from `connect_credentials`. The
 *   caller may ONLY act on `propertyId`; `ConnectScopeGuard` enforces that.
 * - `scope='platform'`: the legacy `CONNECT_API_KEY` env value (trusted server-side
 *   key, e.g. the demo gateway). Cross-tenant by design — bypasses scope checks.
 */
export interface ConnectPrincipal {
  scope: 'property' | 'platform';
  propertyId?: string;
  credentialId?: string;
}

/**
 * API-key guard for agent-facing endpoints (`/api/v1/connect/*`).
 *
 * Resolves the `x-api-key` header to a `ConnectPrincipal` and attaches it to
 * `req.connect`. Lookup order:
 *   1. sha256(key) matches a `connect_credentials.key_hash` (active, not revoked)
 *      → `{ scope:'property', propertyId, credentialId }`.
 *   2. Constant-time match against the comma-separated env `CONNECT_API_KEY`
 *      → `{ scope:'platform' }`.
 *   3. Otherwise → 401.
 *
 * Fail-closed: when `AUTH_ENABLED!=='false'` and there is no DB row AND no env
 * value, the request is rejected. `AUTH_ENABLED='false'` is a no-op (dev/demo).
 *
 * Closes CRITICAL #2 from the security audit (was: single global key, no tenant
 * binding — any key holder could read/write any tenant's Connect data).
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly configService: ConfigService,
    @Optional() @Inject(DRIZZLE) private readonly db?: any,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const authEnabled = this.configService.get<string>('AUTH_ENABLED', 'true');
    if (authEnabled === 'false') {
      // Sandbox/demo parity with the other guards — also attach a platform
      // principal so downstream code that reads req.connect doesn't NPE.
      const req = context.switchToHttp().getRequest<any>();
      req.connect = { scope: 'platform' } as ConnectPrincipal;
      return true;
    }

    const req = context.switchToHttp().getRequest<{ headers: Record<string, string | string[] | undefined>; connect?: ConnectPrincipal }>();
    const headerValue = req.headers['x-api-key'] ?? req.headers['X-API-Key' as any];
    const provided = Array.isArray(headerValue) ? headerValue[0] : headerValue;

    if (!provided || typeof provided !== 'string') {
      throw new UnauthorizedException('Invalid or missing API key');
    }

    // 1) Per-property credential lookup (sha256 hash compare via DB).
    if (this.db) {
      const keyHash = hashConnectKey(provided);
      const rows = await this.db
        .select()
        .from(connectCredentials)
        .where(
          and(
            eq(connectCredentials.keyHash, keyHash),
            eq(connectCredentials.isActive, true),
          ),
        );
      const cred = rows?.[0];
      if (cred && !cred.revokedAt) {
        req.connect = {
          scope: 'property',
          propertyId: cred.propertyId,
          credentialId: cred.id,
        };
        return true;
      }
    }

    // 2) Legacy platform key (cross-tenant, trusted server-side caller).
    const configured = this.configService.get<string>('CONNECT_API_KEY');
    const platformKeys = (configured ?? '')
      .split(',')
      .map((k) => k.trim())
      .filter((k) => k.length > 0);

    if (platformKeys.some((k) => safeEqual(k, provided))) {
      req.connect = { scope: 'platform' };
      return true;
    }

    // 3) No match anywhere → fail closed.
    throw new UnauthorizedException('Invalid or missing API key');
  }
}
