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
import type { BookingEnginePrincipal } from './booking-key.guard';

/**
 * Enforces tenant isolation for the public booking engine once
 * {@link BookingKeyGuard} has attached a {@link BookingEnginePrincipal}.
 *
 * Runs AFTER `BookingKeyGuard`. Fail-closed decision logic for the property-scoped
 * principal (there is no platform scope here):
 *   - any `query.propertyId` / `body.propertyId` must equal the credential's
 *     propertyId (confused-deputy defense — the controller also pins it),
 *   - any `params.confirmationNumber` must resolve to a booking owned by the
 *     credential's property — identical 403 for cross-tenant AND not-found so we
 *     don't leak which confirmation numbers exist.
 *
 * Mirrors `ConnectScopeGuard`, minus the platform-key bypass.
 */
@Injectable()
export class BookingEngineScopeGuard implements CanActivate {
  constructor(
    private readonly configService: ConfigService,
    @Inject(DRIZZLE) private readonly db: any,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.configService.get<string>('AUTH_ENABLED', 'true') === 'false') {
      return true;
    }

    const req = context.switchToHttp().getRequest<any>();
    const principal: BookingEnginePrincipal | undefined = req.bookingEngine;
    if (!principal?.propertyId) {
      // BookingKeyGuard should have set this — defensive 401.
      throw new UnauthorizedException('Booking principal not resolved');
    }
    const scopedPropertyId = principal.propertyId;

    const qProp = req.query?.propertyId;
    if (qProp !== undefined) {
      if (typeof qProp !== 'string' || qProp !== scopedPropertyId) {
        throw new ForbiddenException('Booking key is not scoped to this property');
      }
    }

    const bProp = req.body?.propertyId;
    if (bProp !== undefined) {
      if (typeof bProp !== 'string' || bProp !== scopedPropertyId) {
        throw new ForbiddenException('Booking key is not scoped to this property');
      }
    }

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
        throw new ForbiddenException('Booking key is not scoped to this booking');
      }
    }

    return true;
  }
}
