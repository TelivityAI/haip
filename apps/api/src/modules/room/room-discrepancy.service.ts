import { Injectable, Inject } from '@nestjs/common';
import { eq, and, inArray, lte, gt } from 'drizzle-orm';
import { rooms, reservations } from '@telivityhaip/database';
import { DRIZZLE } from '../../database/database.module';

const IN_HOUSE_STATUSES = ['checked_in', 'stayover', 'due_out'] as const;
const VACANT_STATUSES = ['vacant_clean', 'vacant_dirty'] as const;

export type RoomStatusDiscrepancyKind =
  | 'occupied_without_reservation'
  | 'vacant_with_in_house_reservation';

export interface RoomStatusDiscrepancy {
  kind: RoomStatusDiscrepancyKind;
  roomId: string;
  roomNumber: string;
  roomStatus: string;
  reservationId?: string;
  reservationStatus?: string;
  message: string;
}

@Injectable()
export class RoomDiscrepancyService {
  constructor(@Inject(DRIZZLE) private readonly db: any) {}

  async getDiscrepancies(propertyId: string, date: string) {
    const propertyRooms = await this.db
      .select({
        id: rooms.id,
        number: rooms.number,
        status: rooms.status,
      })
      .from(rooms)
      .where(and(eq(rooms.propertyId, propertyId), eq(rooms.isActive, true)));

    const inHouseReservations = await this.db
      .select({
        id: reservations.id,
        roomId: reservations.roomId,
        status: reservations.status,
      })
      .from(reservations)
      .where(
        and(
          eq(reservations.propertyId, propertyId),
          inArray(reservations.status, [...IN_HOUSE_STATUSES]),
          lte(reservations.arrivalDate, date),
          gt(reservations.departureDate, date),
        ),
      );

    const reservationsByRoom = new Map<string, (typeof inHouseReservations)[number][]>();
    for (const res of inHouseReservations) {
      if (!res.roomId) continue;
      const list = reservationsByRoom.get(res.roomId) ?? [];
      list.push(res);
      reservationsByRoom.set(res.roomId, list);
    }

    const discrepancies: RoomStatusDiscrepancy[] = [];

    for (const room of propertyRooms) {
      const roomReservations = reservationsByRoom.get(room.id) ?? [];

      if (room.status === 'occupied' && roomReservations.length === 0) {
        discrepancies.push({
          kind: 'occupied_without_reservation',
          roomId: room.id,
          roomNumber: room.number,
          roomStatus: room.status,
          message: `Room ${room.number} is marked occupied but has no in-house reservation`,
        });
      }

      if (
        (VACANT_STATUSES as readonly string[]).includes(room.status) &&
        roomReservations.length > 0
      ) {
        for (const res of roomReservations) {
          discrepancies.push({
            kind: 'vacant_with_in_house_reservation',
            roomId: room.id,
            roomNumber: room.number,
            roomStatus: room.status,
            reservationId: res.id,
            reservationStatus: res.status,
            message: `Room ${room.number} is ${room.status} but reservation ${res.id} is ${res.status}`,
          });
        }
      }
    }

    return {
      propertyId,
      date,
      count: discrepancies.length,
      discrepancies,
    };
  }
}
