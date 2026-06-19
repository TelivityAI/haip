import { Injectable, Inject, ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { bookings, reservations, guests, channelConnections, roomTypes, ratePlans } from '@telivityhaip/database';
import { DRIZZLE } from '../../database/database.module';
import { ChannelService } from './channel.service';
import { ChannelAdapterFactory } from './channel-adapter.factory';
import { AriService } from './ari.service';
import { WebhookService } from '../webhook/webhook.service';
import { generateConfirmationToken } from '../connect/connect-booking.service';
import type { ChannelReservation } from './channel-adapter.interface';

@Injectable()
export class InboundReservationService {
  constructor(
    @Inject(DRIZZLE) private readonly db: any,
    private readonly channelService: ChannelService,
    private readonly adapterFactory: ChannelAdapterFactory,
    private readonly ariService: AriService,
    private readonly webhookService: WebhookService,
  ) {}

  /**
   * Process an inbound reservation from a channel (KB 6.1).
   * Handles new, modified, and cancelled reservations.
   * Deduplication key: externalConfirmation + channelCode.
   */
  async processInboundReservation(
    channelConnectionId: string,
    reservation: ChannelReservation,
  ) {
    // Get channel connection for property context and mappings
    const conn = await this.findConnectionForInbound(channelConnectionId);
    const propertyId = conn.propertyId;

    // Check deduplication — scoped to the connection's property to prevent
    // cross-tenant collisions on externalConfirmation + channelCode.
    const existing = await this.findByExternalConfirmation(
      reservation.externalConfirmation,
      reservation.channelCode,
      propertyId,
    );

    if (reservation.status === 'cancelled') {
      return this.handleCancellation(conn, reservation, existing);
    }

    if (reservation.status === 'modified' && existing) {
      return this.handleModification(conn, reservation, existing);
    }

    if (existing) {
      throw new ConflictException(
        `Reservation with external confirmation ${reservation.externalConfirmation} already exists (booking ${existing.confirmationNumber})`,
      );
    }

    return this.handleNewReservation(conn, reservation);
  }

  /**
   * Pull reservations from a channel and process them.
   */
  async pullAndProcessReservations(
    channelConnectionId: string,
    propertyId: string,
    since?: Date,
  ) {
    const conn = await this.channelService.findById(channelConnectionId, propertyId);
    const adapter = this.adapterFactory.getAdapter(conn.adapterType);

    const result = await adapter.pullReservations({
      propertyId,
      channelConnectionId,
      connectionConfig: (conn.config ?? {}) as Record<string, unknown>,
      since,
    });

    const processed: Array<{ externalConfirmation: string; status: string; pmsConfirmation?: string; error?: string }> = [];

    for (const reservation of result.reservations) {
      try {
        const res = await this.processInboundReservation(channelConnectionId, reservation);
        processed.push({
          externalConfirmation: reservation.externalConfirmation,
          status: 'processed',
          pmsConfirmation: res.confirmationNumber,
        });
      } catch (error: any) {
        processed.push({
          externalConfirmation: reservation.externalConfirmation,
          status: 'failed',
          error: error.message,
        });
      }
    }

    return { total: result.reservations.length, processed };
  }

  // --- Private Handlers ---

  private async handleNewReservation(conn: any, reservation: ChannelReservation) {
    const propertyId = conn.propertyId;

    // Resolve channel codes to PMS IDs (outside tx — pure lookups)
    const roomTypeId = this.resolveRoomTypeId(conn, reservation.channelRoomCode);
    const ratePlanId = this.resolveRatePlanId(conn, reservation.channelRateCode);

    // FK ownership (security audit follow-on): the channel connection's
    // roomTypeMapping/ratePlanMapping JSON is operator-supplied. A misconfigured
    // (or maliciously edited) mapping could point at a foreign-tenant id. Verify
    // BOTH resolved ids belong to THIS connection's propertyId before writing.
    await this.assertSamePropertyFk(roomTypes, roomTypeId, propertyId, 'room type');
    await this.assertSamePropertyFk(ratePlans, ratePlanId, propertyId, 'rate plan');

    // Calculate nights
    const arrival = new Date(reservation.arrivalDate);
    const departure = new Date(reservation.departureDate);
    const nights = Math.ceil((departure.getTime() - arrival.getTime()) / (1000 * 60 * 60 * 24));

    // Generate confirmation number
    const confirmationNumber = this.generateConfirmationNumber();

    // Atomically create guest + booking + reservation so we never end up with a half-written record.
    const { guest, booking, pmsReservation } = await this.db.transaction(async (tx: any) => {
      const guest = await this.findOrCreateGuestTx(tx, reservation, propertyId);

      const [booking] = await tx
        .insert(bookings)
        .values({
          propertyId,
          guestId: guest.id,
          confirmationNumber,
          externalConfirmation: reservation.externalConfirmation,
          source: 'ota',
          channelCode: reservation.channelCode,
        })
        .returning();

      const [pmsReservation] = await tx
        .insert(reservations)
        .values({
          propertyId,
          bookingId: booking.id,
          guestId: guest.id,
          arrivalDate: reservation.arrivalDate,
          departureDate: reservation.departureDate,
          nights,
          roomTypeId,
          ratePlanId,
          totalAmount: reservation.totalAmount.toString(),
          currencyCode: reservation.currencyCode,
          adults: reservation.adults,
          children: reservation.children ?? 0,
          specialRequests: reservation.specialRequests,
          status: 'confirmed',
        })
        .returning();

      return { guest, booking, pmsReservation };
    });

    // Confirm back to channel
    try {
      const adapter = this.adapterFactory.getAdapter(conn.adapterType);
      await adapter.confirmReservation({
        channelConnectionId: conn.id,
        connectionConfig: (conn.config ?? {}) as Record<string, unknown>,
        externalConfirmation: reservation.externalConfirmation,
        pmsConfirmationNumber: confirmationNumber,
      });
    } catch {
      // Don't fail the reservation if confirmation callback fails
    }

    // Push updated availability for the reservation date range
    try {
      await this.ariService.pushAvailability(
        propertyId,
        reservation.arrivalDate,
        reservation.departureDate,
      );
    } catch {
      // Fire-and-forget
    }

    // Emit webhook
    await this.webhookService.emit(
      'channel.reservation_received',
      'reservation',
      pmsReservation.id,
      {
        channelCode: reservation.channelCode,
        externalConfirmation: reservation.externalConfirmation,
        confirmationNumber,
        status: 'new',
      },
      propertyId,
    );

    return {
      reservationId: pmsReservation.id,
      bookingId: booking.id,
      confirmationNumber,
      guestId: guest.id,
    };
  }

  private async handleModification(conn: any, reservation: ChannelReservation, existing: any) {
    const propertyId = conn.propertyId;

    // Find the existing reservation linked to this booking — scoped to property.
    const [existingReservation] = await this.db
      .select()
      .from(reservations)
      .where(
        and(
          eq(reservations.bookingId, existing.id),
          eq(reservations.propertyId, propertyId),
        ),
      );

    if (!existingReservation) {
      throw new NotFoundException('Existing reservation not found for modification');
    }

    // Resolve codes
    const roomTypeId = this.resolveRoomTypeId(conn, reservation.channelRoomCode);
    const ratePlanId = this.resolveRatePlanId(conn, reservation.channelRateCode);

    // FK ownership (security audit follow-on): same as handleNewReservation —
    // verify the operator-supplied channel mapping points at THIS connection's
    // propertyId before mutating the reservation.
    await this.assertSamePropertyFk(roomTypes, roomTypeId, propertyId, 'room type');
    await this.assertSamePropertyFk(ratePlans, ratePlanId, propertyId, 'rate plan');

    const arrival = new Date(reservation.arrivalDate);
    const departure = new Date(reservation.departureDate);
    const nights = Math.ceil((departure.getTime() - arrival.getTime()) / (1000 * 60 * 60 * 24));

    // Update reservation
    const [updated] = await this.db
      .update(reservations)
      .set({
        arrivalDate: reservation.arrivalDate,
        departureDate: reservation.departureDate,
        nights,
        roomTypeId,
        ratePlanId,
        totalAmount: reservation.totalAmount.toString(),
        currencyCode: reservation.currencyCode,
        adults: reservation.adults,
        children: reservation.children ?? 0,
        specialRequests: reservation.specialRequests,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(reservations.id, existingReservation.id),
          eq(reservations.propertyId, propertyId),
        ),
      )
      .returning();

    // Push updated availability
    try {
      await this.ariService.pushAvailability(
        propertyId,
        reservation.arrivalDate,
        reservation.departureDate,
      );
    } catch {
      // Fire-and-forget
    }

    await this.webhookService.emit(
      'channel.reservation_received',
      'reservation',
      existingReservation.id,
      {
        channelCode: reservation.channelCode,
        externalConfirmation: reservation.externalConfirmation,
        confirmationNumber: existing.confirmationNumber,
        status: 'modified',
      },
      propertyId,
    );

    return {
      reservationId: existingReservation.id,
      bookingId: existing.id,
      confirmationNumber: existing.confirmationNumber,
      guestId: existingReservation.guestId,
    };
  }

  private async handleCancellation(conn: any, reservation: ChannelReservation, existing: any) {
    if (!existing) {
      throw new NotFoundException(
        `Cannot cancel: reservation with external confirmation ${reservation.externalConfirmation} not found`,
      );
    }

    const propertyId = conn.propertyId;

    // Find the reservation — scoped to property.
    const [existingReservation] = await this.db
      .select()
      .from(reservations)
      .where(
        and(
          eq(reservations.bookingId, existing.id),
          eq(reservations.propertyId, propertyId),
        ),
      );

    if (!existingReservation) {
      throw new NotFoundException('Existing reservation not found for cancellation');
    }

    // Cancel it
    await this.db
      .update(reservations)
      .set({
        status: 'cancelled',
        cancelledAt: new Date(),
        cancellationReason: `Cancelled via channel: ${reservation.channelCode}`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(reservations.id, existingReservation.id),
          eq(reservations.propertyId, propertyId),
        ),
      );

    // Push updated availability
    try {
      await this.ariService.pushAvailability(
        propertyId,
        reservation.arrivalDate,
        reservation.departureDate,
      );
    } catch {
      // Fire-and-forget
    }

    await this.webhookService.emit(
      'channel.reservation_received',
      'reservation',
      existingReservation.id,
      {
        channelCode: reservation.channelCode,
        externalConfirmation: reservation.externalConfirmation,
        confirmationNumber: existing.confirmationNumber,
        status: 'cancelled',
      },
      propertyId,
    );

    return {
      reservationId: existingReservation.id,
      bookingId: existing.id,
      confirmationNumber: existing.confirmationNumber,
      cancelled: true,
    };
  }

  // --- Private Helpers ---

  private async findConnectionForInbound(channelConnectionId: string) {
    // Look up connection without propertyId (inbound doesn't always know it)
    const [conn] = await this.db
      .select()
      .from(channelConnections)
      .where(eq(channelConnections.id, channelConnectionId));

    if (!conn) {
      throw new NotFoundException(`Channel connection ${channelConnectionId} not found`);
    }
    return conn;
  }

  private async findByExternalConfirmation(
    externalConfirmation: string,
    channelCode: string,
    propertyId: string,
  ) {
    const [existing] = await this.db
      .select()
      .from(bookings)
      .where(
        and(
          eq(bookings.propertyId, propertyId),
          eq(bookings.externalConfirmation, externalConfirmation),
          eq(bookings.channelCode, channelCode),
        ),
      );
    return existing ?? null;
  }

  private async findOrCreateGuestTx(tx: any, reservation: ChannelReservation, propertyId: string) {
    // Reuse a guest by email ONLY when that guest is already linked to THIS
    // property via an existing reservation. A bare cross-property email match
    // would let an inbound OTA push attach to (and corrupt) another tenant's
    // guest profile. Otherwise create a fresh row (CLAUDE.md guest rule).
    if (reservation.guestEmail) {
      const matches = await tx
        .select()
        .from(guests)
        .where(eq(guests.email, reservation.guestEmail));
      for (const candidate of matches) {
        const links = await tx
          .select({ id: reservations.id })
          .from(reservations)
          .where(
            and(
              eq(reservations.guestId, candidate.id),
              eq(reservations.propertyId, propertyId),
            ),
          );
        if (links.length > 0) return candidate;
      }
    }
    const [guest] = await tx
      .insert(guests)
      .values({
        firstName: reservation.guestFirstName,
        lastName: reservation.guestLastName,
        email: reservation.guestEmail ?? null,
        phone: reservation.guestPhone ?? null,
      })
      .returning();
    return guest;
  }

  private resolveRoomTypeId(conn: any, channelRoomCode: string): string {
    const roomTypeMapping = (conn.roomTypeMapping ?? []) as Array<{
      roomTypeId: string;
      channelRoomCode: string;
    }>;

    const mapping = roomTypeMapping.find((m) => m.channelRoomCode === channelRoomCode);
    if (!mapping) {
      throw new NotFoundException(
        `No room type mapping found for channel room code '${channelRoomCode}' on connection ${conn.id}`,
      );
    }
    return mapping.roomTypeId;
  }

  private resolveRatePlanId(conn: any, channelRateCode: string): string {
    const ratePlanMapping = (conn.ratePlanMapping ?? []) as Array<{
      ratePlanId: string;
      channelRateCode: string;
    }>;

    const mapping = ratePlanMapping.find((m) => m.channelRateCode === channelRateCode);
    if (!mapping) {
      throw new NotFoundException(
        `No rate plan mapping found for channel rate code '${channelRateCode}' on connection ${conn.id}`,
      );
    }
    return mapping.ratePlanId;
  }

  /**
   * Verify a caller- or mapping-supplied FK row belongs to the SAME property as
   * the channel connection. Mirrors the same check in ReservationService — the
   * channel mapping JSON is operator-supplied and must not be allowed to point
   * at another tenant's room type / rate plan.
   */
  private async assertSamePropertyFk(
    table: { id: any; propertyId: any },
    id: string,
    propertyId: string,
    label: string,
  ): Promise<void> {
    const [row] = await this.db
      .select({ id: table.id })
      .from(table)
      .where(and(eq(table.id, id), eq(table.propertyId, propertyId)));
    if (!row) {
      throw new BadRequestException(`${label} ${id} not found in this property (channel mapping points at foreign tenant)`);
    }
  }

  private generateConfirmationNumber(): string {
    // The confirmation number is a bearer credential for the booking, so it must
    // be unguessable. The previous `Date.now()`-based value with 4 Math.random
    // chars was enumerable; reuse the shared 128-bit CSPRNG token (Crockford b32).
    return `CH-${generateConfirmationToken()}`;
  }
}
