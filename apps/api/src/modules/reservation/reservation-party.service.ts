import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { and, eq, ne, sql } from 'drizzle-orm';
import {
  reservations,
  reservationGuests,
  guests,
  rooms,
  roomTypes,
  ratePlans,
} from '@telivityhaip/database';
import { DRIZZLE } from '../../database/database.module';
import { WebhookService } from '../webhook/webhook.service';
import { RoomStatusService } from '../room/room-status.service';
import { RatePlanService } from '../rate-plan/rate-plan.service';
import { AddReservationGuestDto } from './dto/add-reservation-guest.dto';
import { SplitReservationDto } from './dto/split-reservation.dto';
import { MoveReservationGuestDto } from './dto/move-reservation-guest.dto';

type OccupantRow = {
  id: string;
  propertyId: string;
  reservationId: string;
  guestId: string;
  role: 'primary' | 'accompanying';
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
};

/**
 * Multi-guest / multi-room party operations.
 *
 * Domain (HAIP booking / reservation model):
 * - booking = wrapper for one or more room reservations
 * - reservation = one physical unit + named occupants
 * - reservations.guestId = primary/lead guest (synced with reservation_guests)
 */
@Injectable()
export class ReservationPartyService {
  constructor(
    @Inject(DRIZZLE) private readonly db: any,
    private readonly webhookService: WebhookService,
    private readonly roomStatusService: RoomStatusService,
    private readonly ratePlanService: RatePlanService,
  ) {}

  async listGuests(reservationId: string, propertyId: string): Promise<OccupantRow[]> {
    await this.requireReservation(reservationId, propertyId);
    return this.loadOccupants(reservationId, propertyId);
  }

  async listBookingSiblings(reservationId: string, propertyId: string) {
    const source = await this.requireReservation(reservationId, propertyId);
    const rows = await this.db
      .select({
        reservation: reservations,
        roomNumber: rooms.number,
        roomTypeName: roomTypes.name,
        guestFirstName: guests.firstName,
        guestLastName: guests.lastName,
      })
      .from(reservations)
      .leftJoin(rooms, eq(reservations.roomId, rooms.id))
      .leftJoin(roomTypes, eq(reservations.roomTypeId, roomTypes.id))
      .leftJoin(guests, eq(reservations.guestId, guests.id))
      .where(
        and(
          eq(reservations.bookingId, source.bookingId),
          eq(reservations.propertyId, propertyId),
          ne(reservations.status, 'cancelled' as any),
        ),
      )
      .orderBy(reservations.createdAt);

    return rows.map((r: any) => ({
      ...r.reservation,
      roomNumber: r.roomNumber,
      roomTypeName: r.roomTypeName,
      guestName: r.guestFirstName ? `${r.guestFirstName} ${r.guestLastName}` : null,
    }));
  }

  async addGuest(reservationId: string, propertyId: string, dto: AddReservationGuestDto) {
    const reservation = await this.requireReservation(reservationId, propertyId);
    this.assertMutable(reservation.status);

    const guest = await this.requireGuestProfile(dto.guestId);
    if (guest.isDnr) {
      throw new BadRequestException(
        `Guest ${dto.guestId} is on the Do Not Rent list: ${guest.dnrReason ?? 'No reason given'}`,
      );
    }

    const existing = await this.db
      .select({ id: reservationGuests.id })
      .from(reservationGuests)
      .where(
        and(
          eq(reservationGuests.reservationId, reservationId),
          eq(reservationGuests.guestId, dto.guestId),
          eq(reservationGuests.propertyId, propertyId),
        ),
      )
      .limit(1);
    if (existing.length) {
      throw new ConflictException('Guest is already on this reservation');
    }

    // Same guest cannot occupy two active rooms in the same booking.
    await this.assertNotOnSibling(reservation.bookingId, propertyId, dto.guestId);

    const occupants = await this.loadOccupants(reservationId, propertyId);
    if (!dto.overrideMaxOccupancy) {
      await this.assertWithinMaxOccupancy(reservation.roomTypeId, propertyId, occupants.length + 1);
    }

    const [row] = await this.db
      .insert(reservationGuests)
      .values({
        propertyId,
        reservationId,
        guestId: dto.guestId,
        role: 'accompanying',
      })
      .returning();

    // Keep headcount at least as high as named adults.
    const namedCount = occupants.length + 1;
    if ((reservation.adults ?? 1) < namedCount) {
      await this.db
        .update(reservations)
        .set({ adults: namedCount, updatedAt: new Date() })
        .where(and(eq(reservations.id, reservationId), eq(reservations.propertyId, propertyId)));
    }

    await this.webhookService.emit(
      'reservation.guest_added',
      'reservation',
      reservationId,
      { reservationId, guestId: dto.guestId, role: 'accompanying' },
      propertyId,
    );

    return row;
  }

  async removeGuest(reservationId: string, propertyId: string, guestId: string) {
    const reservation = await this.requireReservation(reservationId, propertyId);
    this.assertMutable(reservation.status);

    const occupants = await this.loadOccupants(reservationId, propertyId);
    const target = occupants.find((o) => o.guestId === guestId);
    if (!target) {
      throw new NotFoundException(`Guest ${guestId} is not on this reservation`);
    }
    if (target.role === 'primary') {
      throw new BadRequestException(
        'Cannot remove the primary guest — split/move them or promote another guest first',
      );
    }
    if (occupants.length <= 1) {
      throw new BadRequestException('Reservation must keep at least one named guest');
    }

    await this.db
      .delete(reservationGuests)
      .where(
        and(
          eq(reservationGuests.reservationId, reservationId),
          eq(reservationGuests.guestId, guestId),
          eq(reservationGuests.propertyId, propertyId),
        ),
      );

    await this.webhookService.emit(
      'reservation.guest_removed',
      'reservation',
      reservationId,
      { reservationId, guestId },
      propertyId,
    );

    return { removed: true, guestId };
  }

  /**
   * Split selected guests onto a new sibling reservation under the same booking.
   */
  async split(reservationId: string, propertyId: string, dto: SplitReservationDto) {
    const source = await this.requireReservation(reservationId, propertyId);
    this.assertMutable(source.status);

    const uniqueGuestIds = [...new Set(dto.guestIds)];
    const occupants = await this.loadOccupants(reservationId, propertyId);
    if (occupants.length <= uniqueGuestIds.length) {
      throw new BadRequestException(
        'Split must leave at least one named guest on the source reservation',
      );
    }

    const moving = occupants.filter((o) => uniqueGuestIds.includes(o.guestId));
    if (moving.length !== uniqueGuestIds.length) {
      throw new BadRequestException('One or more guestIds are not on this reservation');
    }

    const remaining = occupants.filter((o) => !uniqueGuestIds.includes(o.guestId));
    const movingPrimary = moving.find((o) => o.role === 'primary');
    if (movingPrimary && remaining.length === 0) {
      throw new BadRequestException('Cannot move the only guest off the reservation');
    }

    await this.assertSamePropertyFk(roomTypes, dto.roomTypeId, propertyId, 'room type');
    await this.assertSamePropertyFk(ratePlans, dto.ratePlanId, propertyId, 'rate plan');
    if (!dto.overrideMaxOccupancy) {
      await this.assertWithinMaxOccupancy(dto.roomTypeId, propertyId, moving.length);
    }
    await this.ratePlanService.assertSellable(
      propertyId,
      dto.ratePlanId,
      source.arrivalDate,
      source.departureDate,
    );

    let targetRoom: any = null;
    if (dto.roomId) {
      targetRoom = await this.requireAssignableRoom(dto.roomId, propertyId, dto.roomTypeId);
    }

    const newPrimary = movingPrimary ?? moving[0];
    if (!newPrimary) {
      throw new BadRequestException('Split requires at least one guest to move');
    }
    const currencyCode = dto.currencyCode ?? source.currencyCode;
    const adults = dto.adults ?? moving.length;
    const children = dto.children ?? 0;
    const inHouse = ['checked_in', 'stayover', 'due_out'].includes(source.status);

    const result = await this.db.transaction(async (tx: any) => {
      let newStatus: string = source.status === 'pending' ? 'pending' : 'confirmed';
      if (dto.roomId) {
        newStatus = inHouse ? 'checked_in' : 'assigned';
      }

      const [created] = await tx
        .insert(reservations)
        .values({
          propertyId,
          bookingId: source.bookingId,
          guestId: newPrimary.guestId,
          arrivalDate: source.arrivalDate,
          departureDate: source.departureDate,
          nights: source.nights,
          roomTypeId: dto.roomTypeId,
          ratePlanId: dto.ratePlanId,
          totalAmount: dto.totalAmount,
          currencyCode,
          adults,
          children,
          roomId: dto.roomId ?? null,
          status: newStatus,
          groupProfileId: source.groupProfileId,
          specialRequests: source.specialRequests,
          checkedInAt: inHouse && dto.roomId ? new Date() : null,
        })
        .returning();

      // Move guest rows to the new reservation.
      for (const g of moving) {
        const role = g.guestId === newPrimary.guestId ? 'primary' : 'accompanying';
        await tx
          .update(reservationGuests)
          .set({
            reservationId: created.id,
            role,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(reservationGuests.reservationId, reservationId),
              eq(reservationGuests.guestId, g.guestId),
              eq(reservationGuests.propertyId, propertyId),
            ),
          );
      }

      // Ensure source still has a primary.
      if (movingPrimary) {
        const promote = remaining[0];
        if (!promote) {
          throw new BadRequestException(
            'Split must leave at least one named guest on the source reservation',
          );
        }
        await tx
          .update(reservationGuests)
          .set({ role: 'primary', updatedAt: new Date() })
          .where(
            and(
              eq(reservationGuests.reservationId, reservationId),
              eq(reservationGuests.guestId, promote.guestId),
              eq(reservationGuests.propertyId, propertyId),
            ),
          );
        await tx
          .update(reservations)
          .set({
            guestId: promote.guestId,
            adults: Math.max(1, (source.adults ?? 1) - adults),
            updatedAt: new Date(),
          })
          .where(and(eq(reservations.id, reservationId), eq(reservations.propertyId, propertyId)));
      } else {
        await tx
          .update(reservations)
          .set({
            adults: Math.max(1, (source.adults ?? 1) - adults),
            updatedAt: new Date(),
          })
          .where(and(eq(reservations.id, reservationId), eq(reservations.propertyId, propertyId)));
      }

      return created;
    });

    if (inHouse && dto.roomId) {
      await this.roomStatusService.markOccupied(dto.roomId, propertyId);
    }

    await this.webhookService.emit(
      'reservation.created',
      'reservation',
      result.id,
      {
        reservationId: result.id,
        bookingId: source.bookingId,
        splitFromReservationId: reservationId,
        arrivalDate: result.arrivalDate,
        departureDate: result.departureDate,
        roomTypeId: result.roomTypeId,
      },
      propertyId,
    );
    await this.webhookService.emit(
      'reservation.split',
      'reservation',
      reservationId,
      {
        sourceReservationId: reservationId,
        newReservationId: result.id,
        movedGuestIds: uniqueGuestIds,
        roomId: dto.roomId ?? null,
      },
      propertyId,
    );

    return {
      sourceReservationId: reservationId,
      reservation: result,
      movedGuestIds: uniqueGuestIds,
      targetRoom: targetRoom
        ? { id: targetRoom.id, number: targetRoom.number }
        : null,
    };
  }

  /**
   * Move one named guest to another reservation on the same booking.
   */
  async moveGuest(
    reservationId: string,
    propertyId: string,
    guestId: string,
    dto: MoveReservationGuestDto,
  ) {
    if (dto.targetReservationId === reservationId) {
      throw new BadRequestException('Target reservation must be different from the source');
    }

    const source = await this.requireReservation(reservationId, propertyId);
    const target = await this.requireReservation(dto.targetReservationId, propertyId);
    this.assertMutable(source.status);
    this.assertMutable(target.status);

    if (source.bookingId !== target.bookingId) {
      throw new BadRequestException(
        'Guests can only move between reservations on the same booking',
      );
    }

    const sourceOccupants = await this.loadOccupants(reservationId, propertyId);
    const moving = sourceOccupants.find((o) => o.guestId === guestId);
    if (!moving) {
      throw new NotFoundException(`Guest ${guestId} is not on this reservation`);
    }
    if (sourceOccupants.length <= 1) {
      throw new BadRequestException(
        'Cannot move the only named guest — use split with a new room or move-room instead',
      );
    }

    const targetOccupants = await this.loadOccupants(dto.targetReservationId, propertyId);
    if (targetOccupants.some((o) => o.guestId === guestId)) {
      throw new ConflictException('Guest is already on the target reservation');
    }
    await this.assertWithinMaxOccupancy(
      target.roomTypeId,
      propertyId,
      targetOccupants.length + 1,
    );

    const makePrimary = dto.makePrimary === true || targetOccupants.length === 0;

    await this.db.transaction(async (tx: any) => {
      if (makePrimary) {
        // Demote existing primary on target (if any).
        await tx
          .update(reservationGuests)
          .set({ role: 'accompanying', updatedAt: new Date() })
          .where(
            and(
              eq(reservationGuests.reservationId, dto.targetReservationId),
              eq(reservationGuests.propertyId, propertyId),
              eq(reservationGuests.role, 'primary' as any),
            ),
          );
      }

      await tx
        .update(reservationGuests)
        .set({
          reservationId: dto.targetReservationId,
          role: makePrimary ? 'primary' : 'accompanying',
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(reservationGuests.reservationId, reservationId),
            eq(reservationGuests.guestId, guestId),
            eq(reservationGuests.propertyId, propertyId),
          ),
        );

      if (makePrimary) {
        await tx
          .update(reservations)
          .set({ guestId, updatedAt: new Date() })
          .where(
            and(
              eq(reservations.id, dto.targetReservationId),
              eq(reservations.propertyId, propertyId),
            ),
          );
      }

      if (moving.role === 'primary') {
        const promote = sourceOccupants.find((o) => o.guestId !== guestId);
        if (!promote) {
          throw new BadRequestException(
            'Cannot move the only named guest — use split with a new room or move-room instead',
          );
        }
        await tx
          .update(reservationGuests)
          .set({ role: 'primary', updatedAt: new Date() })
          .where(
            and(
              eq(reservationGuests.reservationId, reservationId),
              eq(reservationGuests.guestId, promote.guestId),
              eq(reservationGuests.propertyId, propertyId),
            ),
          );
        await tx
          .update(reservations)
          .set({ guestId: promote.guestId, updatedAt: new Date() })
          .where(and(eq(reservations.id, reservationId), eq(reservations.propertyId, propertyId)));
      }

      // Adjust adult headcounts to named occupancy floors.
      const sourceNamed = sourceOccupants.length - 1;
      const targetNamed = targetOccupants.length + 1;
      await tx
        .update(reservations)
        .set({
          adults: Math.max(sourceNamed, 1),
          updatedAt: new Date(),
        })
        .where(and(eq(reservations.id, reservationId), eq(reservations.propertyId, propertyId)));
      await tx
        .update(reservations)
        .set({
          adults: Math.max(targetNamed, target.adults ?? 1),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(reservations.id, dto.targetReservationId),
            eq(reservations.propertyId, propertyId),
          ),
        );
    });

    await this.webhookService.emit(
      'reservation.guest_moved',
      'reservation',
      reservationId,
      {
        guestId,
        fromReservationId: reservationId,
        toReservationId: dto.targetReservationId,
        makePrimary,
      },
      propertyId,
    );

    return {
      guestId,
      fromReservationId: reservationId,
      toReservationId: dto.targetReservationId,
      makePrimary,
    };
  }

  /** Ensure a newly created reservation has a primary occupant row. */
  async ensurePrimaryOccupant(
    reservationId: string,
    propertyId: string,
    guestId: string,
    tx?: any,
  ) {
    const db = tx ?? this.db;
    const existing = await db
      .select({ id: reservationGuests.id })
      .from(reservationGuests)
      .where(
        and(
          eq(reservationGuests.reservationId, reservationId),
          eq(reservationGuests.guestId, guestId),
        ),
      )
      .limit(1);
    if (existing.length) return;
    await db.insert(reservationGuests).values({
      propertyId,
      reservationId,
      guestId,
      role: 'primary',
    });
  }

  // --- helpers ---

  private async requireReservation(id: string, propertyId: string) {
    const [row] = await this.db
      .select()
      .from(reservations)
      .where(and(eq(reservations.id, id), eq(reservations.propertyId, propertyId)))
      .limit(1);
    if (!row) throw new NotFoundException(`Reservation ${id} not found`);
    return row;
  }

  private async requireGuestProfile(guestId: string) {
    const [guest] = await this.db.select().from(guests).where(eq(guests.id, guestId)).limit(1);
    if (!guest || guest.isDeleted) {
      throw new NotFoundException(`Guest ${guestId} not found`);
    }
    return guest;
  }

  private async loadOccupants(reservationId: string, propertyId: string): Promise<OccupantRow[]> {
    const rows = await this.db
      .select({
        id: reservationGuests.id,
        propertyId: reservationGuests.propertyId,
        reservationId: reservationGuests.reservationId,
        guestId: reservationGuests.guestId,
        role: reservationGuests.role,
        firstName: guests.firstName,
        lastName: guests.lastName,
        email: guests.email,
      })
      .from(reservationGuests)
      .innerJoin(guests, eq(reservationGuests.guestId, guests.id))
      .where(
        and(
          eq(reservationGuests.reservationId, reservationId),
          eq(reservationGuests.propertyId, propertyId),
        ),
      )
      .orderBy(sql`CASE WHEN ${reservationGuests.role} = 'primary' THEN 0 ELSE 1 END`, guests.lastName);

    // Legacy rows before backfill: synthesize primary from reservations.guestId.
    if (!rows.length) {
      const reservation = await this.requireReservation(reservationId, propertyId);
      const [guest] = await this.db
        .select()
        .from(guests)
        .where(eq(guests.id, reservation.guestId))
        .limit(1);
      if (guest) {
        return [
          {
            id: 'legacy-primary',
            propertyId,
            reservationId,
            guestId: guest.id,
            role: 'primary',
            firstName: guest.firstName,
            lastName: guest.lastName,
            email: guest.email,
          },
        ];
      }
    }
    return rows;
  }

  private assertMutable(status: string) {
    const blocked = ['checked_out', 'cancelled', 'no_show'];
    if (blocked.includes(status)) {
      throw new BadRequestException(
        `Cannot change guests for a reservation in '${status}' status`,
      );
    }
  }

  private async assertNotOnSibling(bookingId: string, propertyId: string, guestId: string) {
    const rows = await this.db
      .select({ id: reservationGuests.id, reservationId: reservationGuests.reservationId })
      .from(reservationGuests)
      .innerJoin(reservations, eq(reservationGuests.reservationId, reservations.id))
      .where(
        and(
          eq(reservations.bookingId, bookingId),
          eq(reservations.propertyId, propertyId),
          eq(reservationGuests.guestId, guestId),
          ne(reservations.status, 'cancelled' as any),
        ),
      )
      .limit(1);
    if (rows.length) {
      throw new ConflictException(
        `Guest is already assigned to another room on this booking (${rows[0].reservationId})`,
      );
    }
  }

  private async assertWithinMaxOccupancy(
    roomTypeId: string,
    propertyId: string,
    namedCount: number,
  ) {
    const [rt] = await this.db
      .select({ maxOccupancy: roomTypes.maxOccupancy })
      .from(roomTypes)
      .where(and(eq(roomTypes.id, roomTypeId), eq(roomTypes.propertyId, propertyId)))
      .limit(1);
    if (rt && namedCount > rt.maxOccupancy) {
      throw new BadRequestException(
        `Room type max occupancy is ${rt.maxOccupancy}; cannot place ${namedCount} named guests`,
      );
    }
  }

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
      throw new BadRequestException(`${label} ${id} not found in this property`);
    }
  }

  private async requireAssignableRoom(roomId: string, propertyId: string, roomTypeId: string) {
    const [room] = await this.db
      .select()
      .from(rooms)
      .where(and(eq(rooms.id, roomId), eq(rooms.propertyId, propertyId)))
      .limit(1);
    if (!room) throw new NotFoundException(`Room ${roomId} not found in this property`);
    if (room.roomTypeId !== roomTypeId) {
      throw new BadRequestException(
        `Room ${roomId} is type ${room.roomTypeId}, but split requires type ${roomTypeId}`,
      );
    }
    const allowedStatuses = ['guest_ready', 'vacant_clean'];
    if (!allowedStatuses.includes(room.status)) {
      throw new BadRequestException(
        `Room ${roomId} is not available (status: ${room.status}). Must be 'guest_ready' or 'vacant_clean'.`,
      );
    }
    return room;
  }
}
