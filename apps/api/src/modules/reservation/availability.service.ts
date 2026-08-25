import { BadRequestException, Injectable, Inject } from '@nestjs/common';
import { eq, and, ne, notInArray, sql, lt, gt } from 'drizzle-orm';
import { reservations, roomTypes, properties, rooms, icalBlocks, icalFeeds } from '@telivityhaip/database';
import { DRIZZLE } from '../../database/database.module';

export interface AvailabilityResult {
  roomTypeId: string;
  roomTypeName: string;
  date: string;
  totalRooms: number;
  sold: number;
  available: number;
  overbookingBuffer: number;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Enumerate the exact canonical nights consumed by [checkIn, checkOut). */
export function stayDates(checkIn: string, checkOut: string): string[] {
  if (!ISO_DATE.test(checkIn) || !ISO_DATE.test(checkOut)) {
    throw new BadRequestException('Stay dates must use YYYY-MM-DD');
  }
  const start = new Date(`${checkIn}T00:00:00.000Z`);
  const end = new Date(`${checkOut}T00:00:00.000Z`);
  if (
    Number.isNaN(start.getTime())
    || Number.isNaN(end.getTime())
    || start.toISOString().slice(0, 10) !== checkIn
    || end.toISOString().slice(0, 10) !== checkOut
    || end <= start
  ) {
    throw new BadRequestException('Check-out must be after check-in');
  }

  const dates: string[] = [];
  for (let date = new Date(start); date < end; date.setUTCDate(date.getUTCDate() + 1)) {
    dates.push(date.toISOString().slice(0, 10));
  }
  return dates;
}

/** Require one positive, property-calculated availability row for every night. */
export function assertFullStayAvailability(
  rows: AvailabilityResult[],
  roomTypeId: string,
  checkIn: string,
  checkOut: string,
): void {
  const byDate = new Map(
    rows
      .filter((row) => row.roomTypeId === roomTypeId)
      .map((row) => [row.date, row]),
  );
  const unavailable = stayDates(checkIn, checkOut).find((date) => {
    const row = byDate.get(date);
    return !row || row.available <= 0;
  });
  if (unavailable) {
    throw new BadRequestException(
      `No availability for room type ${roomTypeId} on ${unavailable}`,
    );
  }
}

@Injectable()
export class AvailabilityService {
  constructor(@Inject(DRIZZLE) private readonly db: any) {}

  /**
   * Search availability for a property over a date range.
   * A reservation "occupies" a room on dates from arrivalDate to departureDate - 1.
   * We exclude cancelled, no_show, and checked_out reservations.
   */
  async searchAvailability(
    propertyId: string,
    checkIn: string,
    checkOut: string,
    roomTypeId?: string,
    db?: any,
    options?: { excludeReservationId?: string },
  ): Promise<AvailabilityResult[]> {
    const conn = db ?? this.db;
    const requestedDates = stayDates(checkIn, checkOut);

    // Get property overbooking config
    const [property] = await conn
      .select()
      .from(properties)
      .where(eq(properties.id, propertyId));

    const overbookingPct = property?.overbookingPercentage ?? 0;

    // Get room types for this property
    const roomTypeConditions = [
      eq(roomTypes.propertyId, propertyId),
      eq(roomTypes.isActive, true),
    ];
    if (roomTypeId) {
      roomTypeConditions.push(eq(roomTypes.id, roomTypeId));
    }
    const types = await conn
      .select()
      .from(roomTypes)
      .where(and(...roomTypeConditions));

    // Get overlapping reservations (not cancelled/no_show/checked_out)
    const excludedStatuses = ['cancelled', 'no_show', 'checked_out'] as const;
    const overlapping = await conn
      .select({
        id: reservations.id,
        propertyId: reservations.propertyId,
        roomTypeId: reservations.roomTypeId,
        arrivalDate: reservations.arrivalDate,
        departureDate: reservations.departureDate,
      })
      .from(reservations)
      .where(
        and(
          eq(reservations.propertyId, propertyId),
          notInArray(reservations.status, excludedStatuses as any),
          // Overlap: reservation.arrivalDate < checkOut AND reservation.departureDate > checkIn
          sql`${reservations.arrivalDate} < ${checkOut}`,
          sql`${reservations.departureDate} > ${checkIn}`,
          ...(roomTypeId ? [eq(reservations.roomTypeId, roomTypeId)] : []),
          ...(options?.excludeReservationId
            ? [ne(reservations.id, options.excludeReservationId)]
            : []),
        ),
      );
    const scopedOverlapping = overlapping.filter((reservation: any) =>
      (reservation.propertyId == null || reservation.propertyId === propertyId)
      && (reservation.id == null || reservation.id !== options?.excludeReservationId));

    // Single grouped query for room counts per room type (avoids N+1).
    const roomCountRows = await conn
      .select({
        roomTypeId: rooms.roomTypeId,
        count: sql<number>`count(*)`,
      })
      .from(rooms)
      .where(
        and(
          eq(rooms.propertyId, propertyId),
          eq(rooms.isActive, true),
        ),
      )
      .groupBy(rooms.roomTypeId);

    const roomCountByType = new Map<string, number>(
      roomCountRows.map((r: any) => [r.roomTypeId, Number(r.count ?? 0)]),
    );

    // Active import feeds reduce availability as one busy unit per feed/date.
    // Counting distinct feedIds avoids double-counting overlapping events from
    // the same external calendar.
    const overlappingIcalBlocks = await conn
      .select({
        roomTypeId: icalBlocks.roomTypeId,
        feedId: icalBlocks.feedId,
        startDate: icalBlocks.startDate,
        endDate: icalBlocks.endDate,
      })
      .from(icalBlocks)
      .innerJoin(
        icalFeeds,
        and(
          eq(icalFeeds.id, icalBlocks.feedId),
          eq(icalFeeds.propertyId, propertyId),
          eq(icalFeeds.isActive, true),
          eq(icalFeeds.direction, 'import'),
        ),
      )
      .where(
        and(
          eq(icalBlocks.propertyId, propertyId),
          lt(icalBlocks.startDate, checkOut),
          gt(icalBlocks.endDate, checkIn),
          ...(roomTypeId ? [eq(icalBlocks.roomTypeId, roomTypeId)] : []),
        ),
      );

    // Generate date-level availability
    const results: AvailabilityResult[] = [];
    for (const type of types) {
      const totalRooms = type.maxOccupancy
        ? (roomCountByType.get(type.id) ?? 0)
        : 0;

      for (const dateStr of requestedDates) {

        // Count reservations occupying this room type on this date
        const sold = scopedOverlapping.filter(
          (r: any) =>
            r.roomTypeId === type.id &&
            r.arrivalDate <= dateStr &&
            r.departureDate > dateStr,
        ).length;
        const importedBusy = new Set(
          overlappingIcalBlocks
            .filter(
              (b: any) =>
                b.roomTypeId === type.id &&
                b.startDate <= dateStr &&
                b.endDate > dateStr,
            )
            .map((b: any) => b.feedId),
        ).size;

        const overbookingBuffer = Math.floor(totalRooms * (overbookingPct / 100));
        const available = totalRooms + overbookingBuffer - sold - importedBusy;

        results.push({
          roomTypeId: type.id,
          roomTypeName: type.name,
          date: dateStr,
          totalRooms,
          sold: sold + importedBusy,
          available: Math.max(0, available),
          overbookingBuffer,
        });
      }
    }

    return results;
  }

}
