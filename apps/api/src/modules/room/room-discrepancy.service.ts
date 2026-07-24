import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { eq, and, inArray, lte, gt } from 'drizzle-orm';
import { rooms, reservations, roomDiscrepancyCases } from '@telivityhaip/database';
import { DRIZZLE } from '../../database/database.module';

const IN_HOUSE_STATUSES = ['checked_in', 'stayover', 'due_out'] as const;
const VACANT_STATUSES = ['vacant_clean', 'vacant_dirty'] as const;

/** Neutral mismatch codes (+ legacy compute kinds kept for compatibility). */
export type RoomStatusDiscrepancyKind =
  | 'fo_occupied_hk_vacant'
  | 'fo_vacant_hk_occupied'
  | 'person_count_mismatch'
  | 'occupied_without_reservation'
  | 'vacant_with_in_house_reservation';

export type DiscrepancyLegacyAlias = 'skip' | 'sleep' | 'person';

export interface RoomStatusDiscrepancy {
  kind: RoomStatusDiscrepancyKind;
  /** UI alias: skip = FO occupied / HK vacant; sleep = FO vacant / HK occupied */
  alias?: DiscrepancyLegacyAlias;
  roomId: string;
  roomNumber: string;
  roomStatus: string;
  hkOccupancy?: string;
  reservationId?: string;
  reservationStatus?: string;
  message: string;
  caseId?: string;
  caseStatus?: string;
}

@Injectable()
export class RoomDiscrepancyService {
  constructor(@Inject(DRIZZLE) private readonly db: any) {}

  private aliasFor(kind: RoomStatusDiscrepancyKind): DiscrepancyLegacyAlias | undefined {
    if (kind === 'fo_occupied_hk_vacant' || kind === 'occupied_without_reservation') return 'skip';
    if (kind === 'fo_vacant_hk_occupied' || kind === 'vacant_with_in_house_reservation') return 'sleep';
    if (kind === 'person_count_mismatch') return 'person';
    return undefined;
  }

  async setHkObservation(
    roomId: string,
    propertyId: string,
    dto: { occupancy: 'vacant' | 'occupied' | 'unknown'; persons?: number; observedBy?: string },
  ) {
    const [room] = await this.db
      .select()
      .from(rooms)
      .where(and(eq(rooms.id, roomId), eq(rooms.propertyId, propertyId)));
    if (!room) throw new NotFoundException('Room not found');

    const [updated] = await this.db
      .update(rooms)
      .set({
        hkOccupancy: dto.occupancy,
        hkObservedPersons: dto.persons ?? null,
        hkObservedAt: new Date(),
        hkObservedBy: dto.observedBy ?? null,
        updatedAt: new Date(),
      })
      .where(and(eq(rooms.id, roomId), eq(rooms.propertyId, propertyId)))
      .returning();
    return updated;
  }

  async getDiscrepancies(propertyId: string, date: string) {
    const propertyRooms = await this.db
      .select({
        id: rooms.id,
        number: rooms.number,
        status: rooms.status,
        hkOccupancy: rooms.hkOccupancy,
        hkObservedPersons: rooms.hkObservedPersons,
      })
      .from(rooms)
      .where(and(eq(rooms.propertyId, propertyId), eq(rooms.isActive, true)));

    const inHouseReservations = await this.db
      .select({
        id: reservations.id,
        roomId: reservations.roomId,
        status: reservations.status,
        adults: reservations.adults,
        children: reservations.children,
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

    const openCases = await this.db
      .select()
      .from(roomDiscrepancyCases)
      .where(
        and(
          eq(roomDiscrepancyCases.propertyId, propertyId),
          eq(roomDiscrepancyCases.businessDate, date),
          eq(roomDiscrepancyCases.status, 'open'),
        ),
      );
    const caseByRoomKind = new Map<string, (typeof openCases)[number]>();
    for (const c of openCases) {
      caseByRoomKind.set(`${c.roomId}:${c.kind}`, c);
    }

    const discrepancies: RoomStatusDiscrepancy[] = [];

    for (const room of propertyRooms) {
      const roomReservations = reservationsByRoom.get(room.id) ?? [];
      const foOccupied = roomReservations.length > 0;
      const hk = room.hkOccupancy ?? 'unknown';

      // Prefer HK observation when set; fall back to room.status heuristics
      if (hk === 'vacant' && foOccupied) {
        for (const res of roomReservations) {
          const kind: RoomStatusDiscrepancyKind = 'fo_occupied_hk_vacant';
          const existing = caseByRoomKind.get(`${room.id}:${kind}`);
          discrepancies.push({
            kind,
            alias: 'skip',
            roomId: room.id,
            roomNumber: room.number,
            roomStatus: room.status,
            hkOccupancy: hk,
            reservationId: res.id,
            reservationStatus: res.status,
            message: `Skip: FO occupied (res ${res.id}) but HK reports vacant`,
            caseId: existing?.id,
            caseStatus: existing?.status,
          });
        }
      } else if (hk === 'occupied' && !foOccupied) {
        const kind: RoomStatusDiscrepancyKind = 'fo_vacant_hk_occupied';
        const existing = caseByRoomKind.get(`${room.id}:${kind}`);
        discrepancies.push({
          kind,
          alias: 'sleep',
          roomId: room.id,
          roomNumber: room.number,
          roomStatus: room.status,
          hkOccupancy: hk,
          message: `Sleep: FO vacant but HK reports occupied`,
          caseId: existing?.id,
          caseStatus: existing?.status,
        });
      } else if (hk === 'unknown') {
        // Legacy compute from room.status vs reservations
        if (room.status === 'occupied' && roomReservations.length === 0) {
          const kind: RoomStatusDiscrepancyKind = 'occupied_without_reservation';
          const existing = caseByRoomKind.get(`${room.id}:${kind}`);
          discrepancies.push({
            kind,
            alias: 'skip',
            roomId: room.id,
            roomNumber: room.number,
            roomStatus: room.status,
            hkOccupancy: hk,
            message: `Room ${room.number} is marked occupied but has no in-house reservation`,
            caseId: existing?.id,
            caseStatus: existing?.status,
          });
        }
        if (
          (VACANT_STATUSES as readonly string[]).includes(room.status) &&
          roomReservations.length > 0
        ) {
          for (const res of roomReservations) {
            const kind: RoomStatusDiscrepancyKind = 'vacant_with_in_house_reservation';
            const existing = caseByRoomKind.get(`${room.id}:${kind}`);
            discrepancies.push({
              kind,
              alias: 'sleep',
              roomId: room.id,
              roomNumber: room.number,
              roomStatus: room.status,
              hkOccupancy: hk,
              reservationId: res.id,
              reservationStatus: res.status,
              message: `Room ${room.number} is ${room.status} but reservation ${res.id} is ${res.status}`,
              caseId: existing?.id,
              caseStatus: existing?.status,
            });
          }
        }
      }

      // Person count mismatch when HK persons set
      if (room.hkObservedPersons != null && roomReservations.length > 0) {
        for (const res of roomReservations) {
          const foPersons = (res.adults ?? 0) + (res.children ?? 0);
          if (foPersons !== room.hkObservedPersons) {
            const kind: RoomStatusDiscrepancyKind = 'person_count_mismatch';
            const existing = caseByRoomKind.get(`${room.id}:${kind}`);
            discrepancies.push({
              kind,
              alias: 'person',
              roomId: room.id,
              roomNumber: room.number,
              roomStatus: room.status,
              hkOccupancy: hk,
              reservationId: res.id,
              reservationStatus: res.status,
              message: `Person count: FO ${foPersons} vs HK ${room.hkObservedPersons}`,
              caseId: existing?.id,
              caseStatus: existing?.status,
            });
          }
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

  /** Persist an open case for a computed discrepancy (idempotent per room/kind/date). */
  async ensureCase(
    propertyId: string,
    dto: {
      roomId: string;
      businessDate: string;
      kind: RoomStatusDiscrepancyKind;
      reservationId?: string;
    },
  ) {
    const [existing] = await this.db
      .select()
      .from(roomDiscrepancyCases)
      .where(
        and(
          eq(roomDiscrepancyCases.propertyId, propertyId),
          eq(roomDiscrepancyCases.roomId, dto.roomId),
          eq(roomDiscrepancyCases.businessDate, dto.businessDate),
          eq(roomDiscrepancyCases.kind, dto.kind),
          eq(roomDiscrepancyCases.status, 'open'),
        ),
      )
      .limit(1);
    if (existing) return existing;

    const [created] = await this.db
      .insert(roomDiscrepancyCases)
      .values({
        propertyId,
        roomId: dto.roomId,
        businessDate: dto.businessDate,
        kind: dto.kind,
        reservationId: dto.reservationId,
        status: 'open',
      })
      .returning();
    return created;
  }

  async resolveCase(
    caseId: string,
    propertyId: string,
    dto: { action: string; note?: string; resolvedBy?: string },
  ) {
    const [row] = await this.db
      .select()
      .from(roomDiscrepancyCases)
      .where(and(eq(roomDiscrepancyCases.id, caseId), eq(roomDiscrepancyCases.propertyId, propertyId)));
    if (!row) throw new NotFoundException('Discrepancy case not found');
    if (row.status !== 'open') throw new BadRequestException('Case is not open');

    const [updated] = await this.db
      .update(roomDiscrepancyCases)
      .set({
        status: 'resolved',
        resolutionAction: dto.action,
        resolutionNote: dto.note,
        resolvedAt: new Date(),
        resolvedBy: dto.resolvedBy,
        updatedAt: new Date(),
      })
      .where(and(eq(roomDiscrepancyCases.id, caseId), eq(roomDiscrepancyCases.propertyId, propertyId)))
      .returning();
    return updated;
  }

  async dismissCase(
    caseId: string,
    propertyId: string,
    dto: { note: string; resolvedBy?: string },
  ) {
    if (!dto.note?.trim()) throw new BadRequestException('Dismiss requires a note');
    const [row] = await this.db
      .select()
      .from(roomDiscrepancyCases)
      .where(and(eq(roomDiscrepancyCases.id, caseId), eq(roomDiscrepancyCases.propertyId, propertyId)));
    if (!row) throw new NotFoundException('Discrepancy case not found');
    if (row.status !== 'open') throw new BadRequestException('Case is not open');

    const [updated] = await this.db
      .update(roomDiscrepancyCases)
      .set({
        status: 'dismissed',
        resolutionAction: 'dismiss',
        resolutionNote: dto.note,
        resolvedAt: new Date(),
        resolvedBy: dto.resolvedBy,
        updatedAt: new Date(),
      })
      .where(and(eq(roomDiscrepancyCases.id, caseId), eq(roomDiscrepancyCases.propertyId, propertyId)))
      .returning();
    return updated;
  }

  /** Night-audit helper: open case count for acknowledge (not hard-stop). */
  async openCaseCount(propertyId: string, businessDate: string) {
    const rows = await this.db
      .select({ id: roomDiscrepancyCases.id })
      .from(roomDiscrepancyCases)
      .where(
        and(
          eq(roomDiscrepancyCases.propertyId, propertyId),
          eq(roomDiscrepancyCases.businessDate, businessDate),
          eq(roomDiscrepancyCases.status, 'open'),
        ),
      );
    return { propertyId, businessDate, openCount: rows.length, acknowledgeRequired: rows.length > 0 };
  }
}
