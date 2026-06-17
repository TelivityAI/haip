import {
  Injectable,
  Inject,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { bookingEngineCredentials } from '@telivityhaip/database';
import { DRIZZLE } from '../../database/database.module';

/** sha256(rawKey) → 64-char hex digest (matches `booking_engine_credentials.key_hash`). */
export function hashBookingKey(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/**
 * Principal attached to the request by {@link BookingKeyGuard}.
 *
 * A booking key is ALWAYS property-scoped — there is no platform/cross-tenant
 * variant (unlike the Connect API key). It is *publishable* (ships in the
 * hotel's client-side HTML), so it is deliberately low-trust: the public
 * controller only exposes search / quote / book / read-or-cancel-own-confirmation.
 */
export interface BookingEnginePrincipal {
  propertyId: string;
  credentialId: string;
}

/**
 * API-key guard for the public booking engine (`/api/v1/booking-engine/*`).
 *
 * Resolves the publishable key from the `x-booking-key` header (or `?key=` query
 * param, so a static `<script>`-embedded widget can pass it) to a
 * {@link BookingEnginePrincipal} on `req.bookingEngine`.
 *
 * Lookup: sha256(key) must match an active, non-revoked `booking_engine_credentials`
 * row. A revoked/inactive key is a TERMINAL reject (never silently re-authorized).
 *
 * Fail-closed: when `AUTH_ENABLED!=='false'` and no row matches → 401. Under
 * `AUTH_ENABLED='false'` (dev/demo) the guard attaches the seed demo property so
 * the one-command demo works without a key (sandbox parity with the other guards).
 */
@Injectable()
export class BookingKeyGuard implements CanActivate {
  constructor(
    private readonly configService: ConfigService,
    @Optional() @Inject(DRIZZLE) private readonly db?: any,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<any>();

    if (this.configService.get<string>('AUTH_ENABLED', 'true') === 'false') {
      // Demo parity: attach the seeded demo property so the widget works keyless.
      const demoPropertyId = this.configService.get<string>('DEMO_PROPERTY_ID');
      req.bookingEngine = {
        propertyId: demoPropertyId ?? '00000000-0000-4000-a000-000000000001',
        credentialId: 'demo',
      } as BookingEnginePrincipal;
      return true;
    }

    const headerValue = req.headers?.['x-booking-key'] ?? req.headers?.['X-Booking-Key'];
    const queryValue = typeof req.query?.key === 'string' ? req.query.key : undefined;
    const raw = Array.isArray(headerValue) ? headerValue[0] : (headerValue ?? queryValue);

    if (!raw || typeof raw !== 'string') {
      throw new UnauthorizedException('Invalid or missing booking key');
    }
    if (!this.db) {
      // Fail-closed: without a DB we cannot validate the key.
      throw new UnauthorizedException('Invalid or missing booking key');
    }

    const keyHash = hashBookingKey(raw);
    const rows = await this.db
      .select()
      .from(bookingEngineCredentials)
      .where(eq(bookingEngineCredentials.keyHash, keyHash));
    const cred = rows?.[0];

    if (!cred) {
      throw new UnauthorizedException('Invalid or missing booking key');
    }
    if (cred.isActive === false || cred.revokedAt) {
      throw new UnauthorizedException('Booking key has been revoked');
    }

    req.bookingEngine = {
      propertyId: cred.propertyId,
      credentialId: cred.id,
    } as BookingEnginePrincipal;
    return true;
  }
}
