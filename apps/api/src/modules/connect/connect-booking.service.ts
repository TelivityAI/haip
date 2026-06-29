import { Injectable, Inject, NotFoundException, BadRequestException } from '@nestjs/common';
import { eq, and, ne } from 'drizzle-orm';
import Decimal from 'decimal.js';
import { bookings, reservations, guests, ratePlans, roomTypes, folios, rooms } from '@telivityhaip/database';
import { DRIZZLE } from '../../database/database.module';
import { AvailabilityService } from '../reservation/availability.service';
import { WebhookService } from '../webhook/webhook.service';
import { RatePlanService } from '../rate-plan/rate-plan.service';
import type { AgentBookDto } from './dto/agent-book.dto';
import type { AgentModifyDto } from './dto/agent-modify.dto';
import { randomBytes } from 'crypto';

@Injectable()
export class ConnectBookingService {
  constructor(
    @Inject(DRIZZLE) private readonly db: any,
    private readonly availabilityService: AvailabilityService,
    private readonly webhookService: WebhookService,
    private readonly ratePlanService: RatePlanService,
  ) {}

  /**
   * Book a room — Agent 4.5 (Hotel Booking Agent).
   * Agent bookings auto-confirm (skip pending status).
   */
  async book(dto: AgentBookDto) {
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

    // 4. Calculate nights and total
    const arrival = new Date(dto.checkIn);
    const departure = new Date(dto.checkOut);
    const nights = Math.ceil((departure.getTime() - arrival.getTime()) / (1000 * 60 * 60 * 24));
    // Monetary math via Decimal (baseAmount is a numeric string from PG)
    const baseAmountDec = new Decimal(ratePlan.baseAmount);
    const totalAmountDec = baseAmountDec.times(nights);
    const baseAmount = baseAmountDec.toNumber();
    const totalAmount = totalAmountDec.toNumber();

    // 5. Generate confirmation number. High-entropy (128 bits from randomBytes,
    // Crockford base32, no ambiguous chars) so it can't be enumerated/guessed —
    // the confirmation number is itself a bearer credential for the booking.
    const confirmationNumber = `HAIP-${generateConfirmationToken()}`;

    // 6. Create booking
    const [booking] = await this.db
      .insert(bookings)
      .values({
        propertyId: dto.propertyId,
        guestId: guest.id,
        confirmationNumber,
        externalConfirmation: dto.externalReference,
        source: 'agent',
        channelCode: dto.agentId ?? 'otaip',
      })
      .returning();

    // 7. Create reservation — auto-confirm for agent bookings
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
        status: 'confirmed', // Agent bookings skip pending
      })
      .returning();

    // 8. Build nightly breakdown
    const settings = await this.getPropertySettings(dto.propertyId);
    const taxRate = (settings['taxRate'] as number) ?? 0;
    const nightlyBreakdown = this.buildNightlyBreakdown(baseAmount, nights, arrival, taxRate);

    // 9. Determine payment status
    let paymentStatus: 'none' | 'authorized' | 'charged' = 'none';
    let depositAmount: number | undefined;

    if (dto.paymentMethod === 'prepaid' || dto.paymentMethod === 'virtual_card') {
      // In a real system, process payment via paymentService
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
        externalReference: dto.externalReference,
        totalAmount,
      },
      dto.propertyId,
    );

    return {
      success: true,
      confirmationNumber,
      externalReference: dto.externalReference,
      reservationId: reservation.id,
      status: 'confirmed',
      confirmationCodes: {
        pms: confirmationNumber,
        external: dto.externalReference,
      },
      totalAmount: Math.round(totalAmount * 100) / 100,
      currencyCode: ratePlan.currencyCode,
      nightlyBreakdown,
      cancellationPolicy: this.getCancellationPolicyText(ratePlan),
      paymentStatus,
      depositAmount,
      bookedAt: new Date().toISOString(),
    };
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
   */
  async cancel(confirmationNumber: string, reason?: string) {
    const { booking, reservation } = await this.loadBookingByConfirmation(confirmationNumber);

    if (['cancelled', 'checked_out', 'no_show'].includes(reservation.status)) {
      throw new BadRequestException(`Reservation already ${reservation.status}`);
    }

    // Determine penalty
    const [ratePlan] = await this.db
      .select()
      .from(ratePlans)
      .where(
        and(
          eq(ratePlans.id, reservation.ratePlanId),
          eq(ratePlans.propertyId, booking.propertyId),
        ),
      );

    const penaltyInfo = this.calculateCancellationPenalty(ratePlan, reservation);

    // Cancel the reservation
    await this.db
      .update(reservations)
      .set({
        status: 'cancelled',
        cancelledAt: new Date(),
        cancellationReason: reason ?? 'Cancelled by agent',
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(reservations.id, reservation.id),
          eq(reservations.propertyId, booking.propertyId),
        ),
      );

    // Generate cancellation number
    const cancellationNumber = `CXL-${Date.now().toString(36).toUpperCase()}`;

    // Emit webhook
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
      penaltyApplied: penaltyInfo.penaltyApplied,
      penaltyAmount: penaltyInfo.penaltyAmount,
      refundAmount: penaltyInfo.refundAmount,
      cancellationPolicy: penaltyInfo.policyDescription,
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

  private getCancellationPolicyText(ratePlan: any): string {
    if (ratePlan.type === 'promotional') {
      return 'Non-refundable — no cancellation allowed.';
    }
    return 'Free cancellation up to 24 hours before check-in. First night charge after.';
  }

  private calculateCancellationPenalty(ratePlan: any, reservation: any) {
    // Money math via Decimal; refundAmount / penaltyAmount are displayed as currency
    const totalAmountDec = new Decimal(reservation.totalAmount);
    const totalAmount = totalAmountDec.toNumber();

    // Non-refundable rate
    if (ratePlan?.type === 'promotional') {
      return {
        penaltyApplied: true,
        penaltyAmount: totalAmount,
        refundAmount: 0,
        policyDescription: 'Non-refundable rate — full charge applies.',
      };
    }

    // Default: free cancellation 24h before check-in
    const checkInDate = new Date(reservation.arrivalDate + 'T15:00:00Z');
    const now = new Date();
    const hoursUntilCheckIn = (checkInDate.getTime() - now.getTime()) / (1000 * 60 * 60);

    if (hoursUntilCheckIn >= 24) {
      return {
        penaltyApplied: false,
        penaltyAmount: 0,
        refundAmount: totalAmount,
        policyDescription: 'Free cancellation — cancelled before 24h deadline.',
      };
    }

    // First night penalty
    const nights = reservation.nights || 1;
    const firstNightAmountDec = totalAmountDec.div(nights);
    return {
      penaltyApplied: true,
      penaltyAmount: Number(firstNightAmountDec.toFixed(2)),
      refundAmount: Number(totalAmountDec.minus(firstNightAmountDec).toFixed(2)),
      policyDescription: 'First night charge applies — cancelled within 24 hours of check-in.',
    };
  }
}

// Crockford base32 alphabet (no I/L/O/U — unambiguous when read/typed).
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * 128 bits of cryptographic randomness (16 random bytes) rendered in Crockford
 * base32. Unguessable — the confirmation number is a bearer credential for the
 * booking, so it must not be enumerable (the old `timestamp-4hex` form had only
 * ~16 bits of randomness).
 */
export function generateConfirmationToken(): string {
  const bytes = randomBytes(16);
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += CROCKFORD[bytes[i]! & 0x1f];
    out += CROCKFORD[(bytes[i]! >> 5) & 0x1f];
  }
  return out;
}
