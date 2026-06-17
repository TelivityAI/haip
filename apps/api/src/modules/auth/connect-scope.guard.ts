import {
  Injectable,
  Inject,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { eq } from 'drizzle-orm';
import { bookings } from '@telivityhaip/database';
import { DRIZZLE } from '../../database/database.module';
import type { ConnectPrincipal } from './api-key.guard';

/**
 * Enforces tenant isolation for the Connect API once `ApiKeyGuard` has attached
 * a `ConnectPrincipal` to the request.
 *
 * Runs AFTER `ApiKeyGuard` on `ConnectController`. Decision logic, fail-closed:
 *   1. `scope='platform'` (or `AUTH_ENABLED=false`) → allow (cross-tenant by design).
 *   2. `scope='property'`:
 *      - any `params.id` (the `/connect/properties/:id` route) must equal `propertyId`,
 *      - any `query.propertyId` or `body.propertyId` must equal `propertyId`,
 *      - any `params.confirmationNumber` must resolve to a booking with that `propertyId`.
 *      Else → 403.
 *
 * Closes the residual cross-tenant hole in CRITICAL #2: previously a holder of any
 * valid API key could pass any `propertyId` (or any `confirmationNumber`) and reach
 * cross-tenant data. Now per-property credentials are pinned to their tenant.
 */
@Injectable()
export class ConnectScopeGuard implements CanActivate {
  // `db` is required: the booking-by-confirmation ownership check would otherwise
  // silently degrade to "allow" if DRIZZLE went missing — that would not be
  // fail-closed. DatabaseModule is @Global() so this resolves in every prod wiring;
  // tests inject an explicit mock.
  constructor(
    private readonly configService: ConfigService,
    @Inject(DRIZZLE) private readonly db: any,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.configService.get<string>('AUTH_ENABLED', 'true') === 'false') {
      return true;
    }

    const req = context.switchToHttp().getRequest<any>();
    const principal: ConnectPrincipal | undefined = req.connect;
    if (!principal) {
      // ApiKeyGuard should have set this — defensive 401.
      throw new UnauthorizedException('Connect principal not resolved');
    }
    if (principal.scope === 'platform') return true;

    const scopedPropertyId = principal.propertyId;
    if (!scopedPropertyId) {
      throw new ForbiddenException('Property-scoped credential is missing a propertyId');
    }

    // NB: `params.id` is intentionally NOT enforced as a propertyId here. Several
    // routes share a `:id` segment with completely different semantics — e.g.
    // `/connect/subscriptions/:id` (subscription UUID) and `/connect/properties/:id`
    // (property UUID). The `/connect/properties/:id` membership check is enforced
    // INSIDE that controller method via `userCanAccessConnectProperty`, where the
    // route semantics are known. Subscription routes already carry `?propertyId=`
    // which IS enforced below.

    const qProp = req.query?.propertyId;
    if (typeof qProp === 'string' && qProp !== scopedPropertyId) {
      throw new ForbiddenException('Credential is not scoped to this property');
    }
    if (qProp !== undefined && typeof qProp !== 'string') {
      // Array / non-scalar — anomalous, fail closed (matches PropertyAccessGuard behavior).
      throw new ForbiddenException('Invalid propertyId');
    }

    const bProp = req.body?.propertyId;
    if (typeof bProp === 'string' && bProp !== scopedPropertyId) {
      throw new ForbiddenException('Credential is not scoped to this property');
    }
    if (bProp !== undefined && typeof bProp !== 'string') {
      throw new ForbiddenException('Invalid propertyId');
    }

    // Booking-by-confirmation routes — resolve and verify ownership. Fails
    // closed: if DRIZZLE is somehow not wired, refuse rather than allow.
    const confirmation = req.params?.confirmationNumber;
    if (typeof confirmation === 'string' && confirmation.length > 0) {
      if (!this.db) {
        throw new InternalServerErrorException('Database not wired — refusing to validate booking ownership');
      }
      const rows = await this.db
        .select({ propertyId: bookings.propertyId })
        .from(bookings)
        .where(eq(bookings.confirmationNumber, confirmation));
      const booking = rows?.[0];
      if (!booking || booking.propertyId !== scopedPropertyId) {
        // Don't leak existence — same error in both cases.
        throw new ForbiddenException('Credential is not scoped to this booking');
      }
    }

    return true;
  }
}
