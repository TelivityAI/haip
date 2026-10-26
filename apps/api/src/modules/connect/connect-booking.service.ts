import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Optional,
} from '@nestjs/common';
import { eq, and, ne } from 'drizzle-orm';
import Decimal from 'decimal.js';
import { bookings, reservations, guests, ratePlans, roomTypes, folios, rooms } from '@telivityhaip/database';
import { DRIZZLE } from '../../database/database.module';
import { AvailabilityService } from '../reservation/availability.service';
import { ReservationService } from '../reservation/reservation.service';
import { WebhookService } from '../webhook/webhook.service';
import { RatePlanService } from '../rate-plan/rate-plan.service';
import { PolicyService } from '../policy/policy.service';
import type { AgentBookDto } from './dto/agent-book.dto';
import type { AgentModifyDto } from './dto/agent-modify.dto';
import { generateConfirmationToken } from '../../common/crypto/confirmation-number';
import { ConnectPaymentService } from './connect-payment.service';
import { hashBookRequest } from './connect-payment.helpers';

@Injectable()
export class ConnectBookingService {
  constructor(
    @Inject(DRIZZLE) private readonly db: any,
    private readonly availabilityService: AvailabilityService,
    private readonly reservationService: ReservationService,
    private readonly webhookService: WebhookService,
    private readonly ratePlanService: RatePlanService,
    private readonly policyService: PolicyService,
    @Optional() private readonly connectPayment?: ConnectPaymentService,
  ) {}

  /**
   * Book a room — Agent 4.5 (Hotel Booking Agent).
   * pay_at_property / legacy prepaid: auto-confirm.
   * hosted_checkout: pending until PSP payment / guarantee completes.
   */
  async book(dto: AgentBookDto) {
    const hosted = dto.paymentMethod === 'hosted_checkout';
    if (hosted) {
      if (!dto.guestEmail) {
        throw new BadRequestException('guestEmail is required for hosted_checkout');
      }
      if (!dto.idempotencyKey) {
        throw new BadRequestException('idempotencyKey is required for hosted_checkout');
      }
      if (!this.connectPayment) {
        throw new BadRequestException('Hosted checkout is not available');
      }
    }

    // Idempotent replay for hosted checkout
    if (hosted && this.connectPayment && dto.idempotencyKey) {
      const requestHash = this.buildRequestHash(dto);
      const existing = await this.connectPayment.findByIdempotency(dto.propertyId, dto.idempotencyKey);
      if (existing) {
        if (existing.requestHash !== requestHash) {
          throw new ConflictException('Idempotency-Key reused with a different booking payload');
        }
        const pay = this.connectPayment.toPublicSession(existing);
        return {
          success: true,
          confirmationNumber: existing.confirmationNumber,
          externalReference: dto.externalReference,
          reservationId: existing.reservationId,
          status: existing.status === 'paid' ? 'confirmed' : 'pending_payment',
          confirmationCodes: {
            pms: existing.confirmationNumber,
            external: dto.externalReference,
          },
          totalAmount: undefined,
          currencyCode: existing.currencyCode,
          nightlyBreakdown: [],
          cancellationPolicy: (
            await this.policyService.getPolicySummary(dto.propertyId, dto.ratePlanId)
          ).description,
          paymentStatus: pay.paymentStatus,
          paymentMode: pay.paymentMode,
          paymentUrl: pay.paymentUrl,
          depositAmount: pay.depositDue,
          bookedAt: existing.createdAt instanceof Date
            ? existing.createdAt.toISOString()
            : new Date().toISOString(),
        };
      }
    }

    // 1. Verify rate is still available
    const availability = await this.availabilityService.searchAvailability(
      dto.propertyId,
      dto.checkIn,
      dto.checkOut,
      dto.roomTypeId,
    );

    const minAvailable = availability.length > 0
      ? Math.min(...availability.map((a) => a.available))
      : 0;

    if (minAvailable <= 0) {
      throw new BadRequestException('No availability for the requested dates and room type');
    }

    // 2. Get rate plan to verify it exists and get amount
    const [ratePlan] = await this.db
      .select()
      .from(ratePlans)
      .where(
        and(
          eq(ratePlans.id, dto.ratePlanId),
          eq(ratePlans.propertyId, dto.propertyId),
          eq(ratePlans.isActive, true),
        ),
      );

    if (!ratePlan) {
      throw new NotFoundException(`Rate plan ${dto.ratePlanId} not found or inactive`);
    }

    // 2b. Enforce rate restrictions (stop-sell / CTA / CTD / min-max LOS). Without
    // this, an agent/LLM booking via the Connect API could land on a closed date.
    await this.ratePlanService.assertSellable(dto.propertyId, dto.ratePlanId, dto.checkIn, dto.checkOut);

    // 3. Find or create guest
    const guest = await this.findOrCreateGuest(dto);

    // 4. Calculate nights and tax-inclusive total (match Connect search)
    const arrival = new Date(dto.checkIn);
    const departure = new Date(dto.checkOut);
    const nights = Math.ceil((departure.getTime() - arrival.getTime()) / (1000 * 60 * 60 * 24));
    const settings = await this.getPropertySettings(dto.propertyId);
    const taxRate = (settings['taxRate'] as number) ?? 0;
    const baseAmountDec = new Decimal(ratePlan.baseAmount);
    const baseTotalDec = baseAmountDec.times(nights);
    const taxTotalDec = baseTotalDec.times(taxRate).div(100);
    const totalAmountDec = baseTotalDec.plus(taxTotalDec);
    const baseAmount = baseAmountDec.toNumber();
    const totalAmount = Number(totalAmountDec.toFixed(2));
    const taxAmount = Number(taxTotalDec.toFixed(2));

    // 5. Generate confirmation number. High-entropy (128 bits from randomBytes,
    // Crockford base32, no ambiguous chars) so it can't be enumerated/guessed —
    // the confirmation number is itself a bearer credential for the booking.
    const confirmationNumber = `HAIP-${generateConfirmationToken()}`;

    // Prefer explicit agentId from the client (external gateways send their own
    // channel codes). Neutral default for hosted checkout when omitted.
    const channelCode = dto.agentId ?? (hosted ? 'connect' : 'otaip');
    const externalRef = dto.externalReference
      ?? (dto.clientPlatform ? `${dto.clientPlatform}:${confirmationNumber}` : undefined);

    // 6. Create booking
    const [booking] = await this.db
      .insert(bookings)
      .values({
        propertyId: dto.propertyId,
        guestId: guest.id,
        confirmationNumber,
        externalConfirmation: externalRef,
        source: 'agent',
        channelCode,
      })
      .returning();

    // 7. Create reservation — pending for hosted checkout, confirmed otherwise
    const [reservation] = await this.db
      .insert(reservations)
      .values({
        propertyId: dto.propertyId,
        bookingId: booking.id,
        guestId: guest.id,
        arrivalDate: dto.checkIn,
        departureDate: dto.checkOut,
        nights,
        roomTypeId: dto.roomTypeId,
        ratePlanId: dto.ratePlanId,
        totalAmount: totalAmountDec.toFixed(2),
        currencyCode: ratePlan.currencyCode,
        adults: dto.adults,
        children: dto.children ?? 0,
        specialRequests: dto.specialRequests,
        status: hosted ? 'pending' : 'confirmed',
      })
      .returning();

    // 8. Build nightly breakdown
    const nightlyBreakdown = this.buildNightlyBreakdown(baseAmount, nights, arrival, taxRate);

    // 9. Hosted payment session or legacy payment flags
    let paymentStatus: string = 'none';
    let depositAmount: number | undefined;
    let paymentUrl: string | null | undefined;
    let paymentMode: string | undefined;

    if (hosted && this.connectPayment && dto.idempotencyKey && dto.guestEmail) {
      const pay = await this.connectPayment.createHostedSession({
        propertyId: dto.propertyId,
        confirmationNumber,
        reservationId: reservation.id,
        bookingId: booking.id,
        guestId: guest.id,
        currencyCode: ratePlan.currencyCode,
        grandTotal: totalAmountDec,
        nights,
        idempotencyKey: dto.idempotencyKey,
        requestHash: this.buildRequestHash(dto),
        clientPlatform: dto.clientPlatform,
        guestEmail: dto.guestEmail,
      });
      paymentStatus = pay.paymentStatus;
      depositAmount = pay.depositDue;
      paymentUrl = pay.paymentUrl;
      paymentMode = pay.paymentMode;
    } else if (dto.paymentMethod === 'prepaid' || dto.paymentMethod === 'virtual_card') {
      // Legacy stub — prefer hosted_checkout for real money movement
      paymentStatus = 'authorized';
      depositAmount = totalAmount;
    }

    // 10. Emit webhook
    await this.webhookService.emit(
      'connect.booking_created',
      'reservation',
      reservation.id,
      {
        confirmationNumber,
        agentId: dto.agentId,
        externalReference: externalRef,
        totalAmount,
        taxAmount,
        paymentMode,
      },
      dto.propertyId,
    );

    return {
      success: true,
      confirmationNumber,
      externalReference: externalRef,
      reservationId: reservation.id,
      status: hosted ? 'pending_payment' : 'confirmed',
      confirmationCodes: {
        pms: confirmationNumber,
        external: externalRef,
      },
      totalAmount,
      taxAmount,
      currencyCode: ratePlan.currencyCode,
      nightlyBreakdown,
      cancellationPolicy: (
        await this.policyService.getPolicySummary(dto.propertyId, dto.ratePlanId)
      ).description,
      paymentStatus,
      paymentMode,
      paymentUrl,
      depositAmount,
      bookedAt: new Date().toISOString(),
    };
  }

  private buildRequestHash(dto: AgentBookDto): string {
    return hashBookRequest({
      propertyId: dto.propertyId,
      roomTypeId: dto.roomTypeId,
      ratePlanId: dto.ratePlanId,
      checkIn: dto.checkIn,
      checkOut: dto.checkOut,
      guestFirstName: dto.guestFirstName,
      guestLastName: dto.guestLastName,
      guestEmail: dto.guestEmail ?? null,
      adults: dto.adults,
      children: dto.children ?? 0,
      paymentMethod: dto.paymentMethod ?? null,
    });
  }

  /**
   * Verify booking — Agent 4.7 (Confirmation Verification).
   */
  async verify(confirmationNumber: string) {
    const { booking, reservation } = await this.loadBookingByConfirmation(confirmationNumber);
    const propertyId = booking.propertyId;

    // Get guest name
    const [guest] = await this.db
      .select()
      .from(guests)
      .where(eq(guests.id, reservation.guestId));

    // Get room type name
    const [roomType] = await this.db
      .select()
      .from(roomTypes)
      .where(
        and(
          eq(roomTypes.id, reservation.roomTypeId),
          eq(roomTypes.propertyId, propertyId),
        ),
      );

    // Check room assignment
    let roomNumber: string | undefined;
    if (reservation.roomId) {
      const [room] = await this.db
        .select()
        .from(rooms)
        .where(
          and(
            eq(rooms.id, reservation.roomId),
            eq(rooms.propertyId, propertyId),
          ),
        );
      roomNumber = room?.number;
    }

    // Check folio
    const folioList = await this.db
      .select()
      .from(folios)
      .where(
        and(
          eq(folios.reservationId, reservation.id),
          eq(folios.propertyId, propertyId),
        ),
      );

    const folio = folioList[0];

    return {
      status: reservation.status,
      confirmationNumber,
      reservationId: reservation.id,
      guestName: guest ? `${guest.firstName} ${guest.lastName}` : 'Unknown',
      checkIn: reservation.arrivalDate,
      checkOut: reservation.departureDate,
      roomType: roomType?.name ?? 'Unknown',
      rateAmount: new Decimal(reservation.totalAmount).toNumber(),
      currencyCode: reservation.currencyCode,
      roomAssigned: !!reservation.roomId,
      roomNumber,
      folioExists: !!folio,
      folioBalance: folio ? new Decimal(folio.balance).toNumber() : undefined,
      lastModified: reservation.updatedAt?.toISOString() ?? reservation.createdAt.toISOString(),
      verifiedAt: new Date().toISOString(),
    };
  }

  /**
   * Modify booking — Agent 4.6 (Modification & Cancellation).
   */
  async modify(confirmationNumber: string, dto: AgentModifyDto) {
    const { booking, reservation } = await this.loadBookingByConfirmation(confirmationNumber);

    if (['cancelled', 'checked_out', 'no_show'].includes(reservation.status)) {
      throw new BadRequestException(`Cannot modify reservation in ${reservation.status} status`);
    }

    const updateFields: Record<string, any> = { updatedAt: new Date() };
    let costDifferenceDec = new Decimal(0);
    const previousAmountDec = new Decimal(reservation.totalAmount);
    const previousAmount = previousAmountDec.toNumber();

    // Handle guest detail updates. The `guests` row is cross-property by design,
    // so overwriting it in place would corrupt the profile as seen by OTHER
    // properties that share this guest. Only mutate in place when the guest is
    // NOT linked to any other property; otherwise fork a property-local copy and
    // repoint this reservation, leaving the shared row untouched.
    if (dto.guestFirstName || dto.guestLastName) {
      const guestUpdate: Record<string, any> = {};
      if (dto.guestFirstName) guestUpdate['firstName'] = dto.guestFirstName;
      if (dto.guestLastName) guestUpdate['lastName'] = dto.guestLastName;

      const otherPropertyLinks = await this.db
        .select({ id: reservations.id })
        .from(reservations)
        .where(
          and(
            eq(reservations.guestId, reservation.guestId),
            ne(reservations.propertyId, booking.propertyId),
          ),
        );

      if (otherPropertyLinks.length > 0) {
        const [current] = await this.db
          .select()
          .from(guests)
          .where(eq(guests.id, reservation.guestId));
        const [forked] = await this.db
          .insert(guests)
          .values({
            firstName: guestUpdate['firstName'] ?? current?.firstName,
            lastName: guestUpdate['lastName'] ?? current?.lastName,
            email: current?.email ?? null,
            phone: current?.phone ?? null,
            loyaltyNumber: current?.loyaltyNumber ?? null,
          })
          .returning();
        await this.db
          .update(reservations)
          .set({ guestId: forked.id, updatedAt: new Date() })
          .where(
            and(
              eq(reservations.id, reservation.id),
              eq(reservations.propertyId, booking.propertyId),
            ),
          );
        reservation.guestId = forked.id;
      } else {
        await this.db
          .update(guests)
          .set(guestUpdate)
          .where(eq(guests.id, reservation.guestId));
      }
    }

    // Handle simple field updates
    if (dto.specialRequests !== undefined) updateFields['specialRequests'] = dto.specialRequests;
    if (dto.adults !== undefined) updateFields['adults'] = dto.adults;
    if (dto.children !== undefined) updateFields['children'] = dto.children;

    // Handle date/room/rate changes (triggers re-calculation)
    if (dto.checkIn || dto.checkOut || dto.roomTypeId || dto.ratePlanId) {
      const newCheckIn = dto.checkIn ?? reservation.arrivalDate;
      const newCheckOut = dto.checkOut ?? reservation.departureDate;
      const newRoomTypeId = dto.roomTypeId ?? reservation.roomTypeId;
      const newRatePlanId = dto.ratePlanId ?? reservation.ratePlanId;

      // FK ownership (security audit follow-on): the caller (an OTAIP agent) could
      // pass a roomTypeId / ratePlanId that belongs to another property. Verify
      // both belong to the booking's property BEFORE the rate re-calculation and
      // the reservation update.
      if (dto.roomTypeId) {
        const [rt] = await this.db
          .select({ id: roomTypes.id })
          .from(roomTypes)
          .where(and(eq(roomTypes.id, newRoomTypeId), eq(roomTypes.propertyId, booking.propertyId)));
        if (!rt) throw new BadRequestException(`room type ${newRoomTypeId} not found in this property`);
      }

      // Re-check availability
      const availability = await this.availabilityService.searchAvailability(
        booking.propertyId,
        newCheckIn,
        newCheckOut,
        newRoomTypeId,
      );

      const minAvailable = availability.length > 0
        ? Math.min(...availability.map((a) => a.available))
        : 0;

      if (minAvailable <= 0) {
        throw new BadRequestException('No availability for modified dates/room type');
      }

      // Re-calculate rate — same-property scoped (was bare-id before).
      const [ratePlan] = await this.db
        .select()
        .from(ratePlans)
        .where(and(eq(ratePlans.id, newRatePlanId), eq(ratePlans.propertyId, booking.propertyId)));

      if (!ratePlan) {
        throw new NotFoundException(`Rate plan ${newRatePlanId} not found in this property`);
      }

      const arrival = new Date(newCheckIn);
      const departure = new Date(newCheckOut);
      const nights = Math.ceil((departure.getTime() - arrival.getTime()) / (1000 * 60 * 60 * 24));
      const newTotalDec = new Decimal(ratePlan.baseAmount).times(nights);

      updateFields['arrivalDate'] = newCheckIn;
      updateFields['departureDate'] = newCheckOut;
      updateFields['nights'] = nights;
      updateFields['roomTypeId'] = newRoomTypeId;
      updateFields['ratePlanId'] = newRatePlanId;
      updateFields['totalAmount'] = newTotalDec.toFixed(2);
      updateFields['currencyCode'] = ratePlan.currencyCode;

      costDifferenceDec = newTotalDec.minus(previousAmountDec);
    }

    // Apply update
    const [updated] = await this.db
      .update(reservations)
      .set(updateFields)
      .where(
        and(
          eq(reservations.id, reservation.id),
          eq(reservations.propertyId, booking.propertyId),
        ),
      )
      .returning();

    // Emit webhook
    await this.webhookService.emit(
      'connect.booking_modified',
      'reservation',
      reservation.id,
      { confirmationNumber, modifications: Object.keys(dto).filter((k) => (dto as any)[k] !== undefined) },
      booking.propertyId,
    );

    return {
      success: true,
      confirmationNumber,
      reservationId: reservation.id,
      status: updated.status,
      previousAmount: Number(previousAmountDec.toFixed(2)),
      newAmount: Number(new Decimal(updated.totalAmount).toFixed(2)),
      costDifference: Number(costDifferenceDec.toFixed(2)),
      modifiedAt: new Date().toISOString(),
    };
  }

  /**
   * Cancel booking — Agent 4.6 (Modification & Cancellation).
   * Delegates status + money settlement to ReservationService.cancel.
   */
  async cancel(confirmationNumber: string, reason?: string) {
    const { booking, reservation } = await this.loadBookingByConfirmation(confirmationNumber);

    if (['cancelled', 'checked_out', 'no_show'].includes(reservation.status)) {
      throw new BadRequestException(`Reservation already ${reservation.status}`);
    }

    const cancelled = await this.reservationService.cancel(
      reservation.id,
      booking.propertyId,
      { cancellationReason: reason ?? 'Cancelled by agent' },
    );

    const settlement = (cancelled as any).cancellationSettlement;
    const totalAmountDec = new Decimal(reservation.totalAmount);
    const penaltyAmount = settlement
      ? Number(new Decimal(settlement.penaltyAmount).toFixed(2))
      : 0;
    const refundAmount = Number(totalAmountDec.minus(penaltyAmount).toFixed(2));

    const cancellationNumber = `CXL-${Date.now().toString(36).toUpperCase()}`;

    await this.webhookService.emit(
      'connect.booking_cancelled',
      'reservation',
      reservation.id,
      { confirmationNumber, cancellationNumber, reason },
      booking.propertyId,
    );

    return {
      cancelled: true,
      confirmationNumber,
      cancellationNumber,
      penaltyApplied: penaltyAmount > 0,
      penaltyAmount,
      refundAmount: Math.max(0, refundAmount),
      cancellationPolicy:
        settlement?.policyDescription ??
        'Cancellation settled per rate plan policy.',
    };
  }

  // --- Private Helpers ---

  private async loadBookingByConfirmation(confirmationNumber: string) {
    const [booking] = await this.db
      .select()
      .from(bookings)
      .where(eq(bookings.confirmationNumber, confirmationNumber));

    if (!booking) {
      throw new NotFoundException(`Booking ${confirmationNumber} not found`);
    }

    const [reservation] = await this.db
      .select()
      .from(reservations)
      .where(
        and(
          eq(reservations.bookingId, booking.id),
          eq(reservations.propertyId, booking.propertyId),
        ),
      );

    if (!reservation) {
      throw new NotFoundException('Reservation not found for this booking');
    }

    return { booking, reservation };
  }

  private async findOrCreateGuest(dto: AgentBookDto) {
    // Try to find by email — but ONLY reuse a guest that is already linked to
    // THIS property via an existing reservation. The `guests` row is cross-property
    // by design, yet a bare email match would let one tenant attach to (and later,
    // via modify(), overwrite) another tenant's guest profile. Scope reuse to the
    // requesting property; otherwise create a fresh row (CLAUDE.md guest rule).
    if (dto.guestEmail) {
      const matches = await this.db
        .select()
        .from(guests)
        .where(eq(guests.email, dto.guestEmail));
      for (const candidate of matches) {
        const links = await this.db
          .select({ id: reservations.id })
          .from(reservations)
          .where(
            and(
              eq(reservations.guestId, candidate.id),
              eq(reservations.propertyId, dto.propertyId),
            ),
          );
        if (links.length > 0) return candidate;
      }
    }

    // Create new guest
    const [guest] = await this.db
      .insert(guests)
      .values({
        firstName: dto.guestFirstName,
        lastName: dto.guestLastName,
        email: dto.guestEmail ?? null,
        phone: dto.guestPhone ?? null,
        loyaltyNumber: dto.loyaltyNumber ?? null,
      })
      .returning();

    return guest;
  }

  private async getPropertySettings(propertyId: string): Promise<Record<string, unknown>> {
    const { properties: props } = await import('@telivityhaip/database');
    const [property] = await this.db
      .select({ settings: props.settings })
      .from(props)
      .where(eq(props.id, propertyId));
    return (property?.settings ?? {}) as Record<string, unknown>;
  }

  private buildNightlyBreakdown(
    baseAmount: number,
    nights: number,
    arrival: Date,
    taxRate: number,
  ) {
    const breakdown = [];
    const baseAmountDec = new Decimal(baseAmount);
    const taxPerNightDec = baseAmountDec.times(taxRate).div(100);
    for (let i = 0; i < nights; i++) {
      const date = new Date(arrival);
      date.setDate(date.getDate() + i);
      const dateStr = date.toISOString().split('T')[0]!;
      breakdown.push({
        date: dateStr,
        rate: Number(baseAmountDec.toFixed(2)),
        tax: Number(taxPerNightDec.toFixed(2)),
      });
    }
    return breakdown;
  }
}

export { generateConfirmationToken } from '../../common/crypto/confirmation-number';
