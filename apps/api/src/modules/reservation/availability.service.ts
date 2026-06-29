import { Injectable, Inject } from '@nestjs/common';
import { eq, and, notInArray, lte, gte, sql } from 'drizzle-orm';
import { reservations, roomTypes, properties, rooms } from '@telivityhaip/database';
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
  ): Promise<AvailabilityResult[]> {
    const conn = db ?? this.db;

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
        ),
      );

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

    // Generate date-level availability
    const results: AvailabilityResult[] = [];
    const startDate = new Date(checkIn);
    const endDate = new Date(checkOut);

    for (const type of types) {
      const totalRooms = type.maxOccupancy
        ? (roomCountByType.get(type.id) ?? 0)
        : 0;

      for (
        let d = new Date(startDate);
        d < endDate;
        d.setDate(d.getDate() + 1)
      ) {
        const dateStr = d.toISOString().split('T')[0]!;

        // Count reservations occupying this room type on this date
        const sold = overlapping.filter(
          (r: any) =>
            r.roomTypeId === type.id &&
            r.arrivalDate <= dateStr &&
            r.departureDate > dateStr,
        ).length;

        const overbookingBuffer = Math.floor(totalRooms * (overbookingPct / 100));
        const available = totalRooms + overbookingBuffer - sold;

        results.push({
          roomTypeId: type.id,
          roomTypeName: type.name,
          date: dateStr,
          totalRooms,
          sold,
          available: Math.max(0, available),
          overbookingBuffer,
        });
      }
    }

    return results;
  }

}
