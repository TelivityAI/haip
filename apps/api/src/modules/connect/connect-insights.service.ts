// Modified by inHotel Sàrl for inPMS; see NOTICE for upstream provenance.
import { Injectable, Inject } from '@nestjs/common';
import { eq, and, sql, gte, lte } from 'drizzle-orm';
import Decimal from 'decimal.js';
import {
  properties,
  reservations,
  rooms,
  ratePlans,
  housekeepingTasks,
} from '@inhotel-io/database';
import { DRIZZLE } from '../../database/database.module';

@Injectable()
export class ConnectInsightsService {
  constructor(@Inject(DRIZZLE) private readonly db: any) {}

  /**
   * Revenue optimization hints — for Agent 4.4 (Rate Comparison).
   * Rule-based suggestions, not ML.
   */
  async getRevenueInsights(propertyId: string, date: string) {
    const [property] = await this.db
      .select()
      .from(properties)
      .where(eq(properties.id, propertyId));

    if (!property) {
      return this.emptyRevenueInsights(propertyId, date);
    }

    const totalRooms = property.totalRooms ?? 0;

    // Count rooms sold for this date
    const inHouseStatuses = ['confirmed', 'assigned', 'checked_in', 'stayover', 'due_out'] as const;
    const soldReservations = await this.db
      .select()
      .from(reservations)
      .where(
        and(
          eq(reservations.propertyId, propertyId),
          sql`${reservations.arrivalDate} <= ${date}`,
          sql`${reservations.departureDate} > ${date}`,
          sql`${reservations.status} IN ('confirmed', 'assigned', 'checked_in', 'stayover', 'due_out')`,
        ),
      );

    const roomsSold = soldReservations.length;
    const roomsAvailable = Math.max(0, totalRooms - roomsSold);
    const occupancyRate = totalRooms > 0 ? (roomsSold / totalRooms) * 100 : 0;

    // Calculate ADR via Decimal — displayed as currency
    const totalRevenueDec = soldReservations.reduce((sum: Decimal, r: any) => {
      const amount = r.totalAmount ? new Decimal(r.totalAmount) : new Decimal(0);
      const nights = r.nights || 1;
      return sum.plus(amount.div(nights));
    }, new Decimal(0));
    const totalRevenue = totalRevenueDec.toNumber();
    const adr = roomsSold > 0 ? totalRevenueDec.div(roomsSold).toNumber() : 0;
    const revpar = totalRooms > 0 ? totalRevenueDec.div(totalRooms).toNumber() : 0;

    // Count today's new reservations and cancellations
    const reservationsToday = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(reservations)
      .where(
        and(
          eq(reservations.propertyId, propertyId),
          sql`${reservations.createdAt}::date = ${date}`,
        ),
      );

    const cancellationsToday = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(reservations)
      .where(
        and(
          eq(reservations.propertyId, propertyId),
          eq(reservations.status, 'cancelled'),
          sql`${reservations.cancelledAt}::date = ${date}`,
        ),
      );

    // Get current BAR rate
    const [barRate] = await this.db
      .select()
      .from(ratePlans)
      .where(
        and(
          eq(ratePlans.propertyId, propertyId),
          eq(ratePlans.type, 'bar'),
          eq(ratePlans.isActive, true),
        ),
      );

    // Generate suggestions
    const suggestions = this.generateRevenueSuggestions(occupancyRate, adr, roomsAvailable, totalRooms);

    return {
      date,
      propertyId,
      occupancyRate: Math.round(occupancyRate * 100) / 100,
      adr: Math.round(adr * 100) / 100,
      revpar: Math.round(revpar * 100) / 100,
      roomsAvailable,
      roomsSold,
      reservationsToday: Number(reservationsToday[0]?.count ?? 0),
      cancellationsToday: Number(cancellationsToday[0]?.count ?? 0),
      currentBarRate: barRate ? new Decimal(barRate.baseAmount).toNumber() : 0,
      barRatePlanId: barRate?.id,
      suggestions,
    };
  }

  /**
   * Guest communication triggers — lifecycle-based communication signals.
   */
  async getGuestTriggers(propertyId: string, date: string) {
    const triggers: Array<{
      type: string;
      reservationId: string;
      guestId: string;
      guestName: string;
      guestEmail?: string;
      scheduledFor: string;
      context: Record<string, unknown>;
    }> = [];

    const tomorrow = this.addDays(date, 1);
    const yesterday = this.addDays(date, -1);

    // Pre-arrival: guests arriving tomorrow
    const arrivingTomorrow = await this.db
      .select()
      .from(reservations)
      .where(
        and(
          eq(reservations.propertyId, propertyId),
          eq(reservations.arrivalDate, tomorrow),
          sql`${reservations.status} IN ('confirmed', 'assigned')`,
        ),
      );

    for (const res of arrivingTomorrow) {
      const guest = await this.getGuestInfo(res.guestId);
      triggers.push({
        type: 'pre_arrival',
        reservationId: res.id,
        guestId: res.guestId,
        guestName: guest.name,
        guestEmail: guest.email,
        scheduledFor: `${date}T10:00:00`,
        context: { checkIn: res.arrivalDate, checkOut: res.departureDate, nights: res.nights },
      });
    }

    // Check-in ready: guests with rooms assigned arriving today
    const arrivingToday = await this.db
      .select()
      .from(reservations)
      .where(
        and(
          eq(reservations.propertyId, propertyId),
          eq(reservations.arrivalDate, date),
          eq(reservations.status, 'assigned'),
        ),
      );

    for (const res of arrivingToday) {
      const guest = await this.getGuestInfo(res.guestId);
      triggers.push({
        type: 'check_in_ready',
        reservationId: res.id,
        guestId: res.guestId,
        guestName: guest.name,
        guestEmail: guest.email,
        scheduledFor: `${date}T14:00:00`,
        context: { roomId: res.roomId },
      });
    }

    // In-stay offer: stayover guests
    const stayoverGuests = await this.db
      .select()
      .from(reservations)
      .where(
        and(
          eq(reservations.propertyId, propertyId),
          sql`${reservations.arrivalDate} < ${date}`,
          sql`${reservations.departureDate} > ${tomorrow}`,
          sql`${reservations.status} IN ('checked_in', 'stayover')`,
        ),
      );

    for (const res of stayoverGuests) {
      const guest = await this.getGuestInfo(res.guestId);
      triggers.push({
        type: 'in_stay_offer',
        reservationId: res.id,
        guestId: res.guestId,
        guestName: guest.name,
        guestEmail: guest.email,
        scheduledFor: `${date}T11:00:00`,
        context: { nightsRemaining: res.nights, departureDate: res.departureDate },
      });
    }

    // Pre-departure: guests checking out tomorrow
    const departingTomorrow = await this.db
      .select()
      .from(reservations)
      .where(
        and(
          eq(reservations.propertyId, propertyId),
          eq(reservations.departureDate, tomorrow),
          sql`${reservations.status} IN ('checked_in', 'stayover', 'due_out')`,
        ),
      );

    for (const res of departingTomorrow) {
      const guest = await this.getGuestInfo(res.guestId);
      triggers.push({
        type: 'pre_departure',
        reservationId: res.id,
        guestId: res.guestId,
        guestName: guest.name,
        guestEmail: guest.email,
        scheduledFor: `${date}T18:00:00`,
        context: { checkOut: res.departureDate },
      });
    }

    // Post-stay: guests who checked out today
    const checkedOutToday = await this.db
      .select()
      .from(reservations)
      .where(
        and(
          eq(reservations.propertyId, propertyId),
          eq(reservations.status, 'checked_out'),
          sql`${reservations.checkedOutAt}::date = ${date}`,
        ),
      );

    for (const res of checkedOutToday) {
      const guest = await this.getGuestInfo(res.guestId);
      triggers.push({
        type: 'post_stay',
        reservationId: res.id,
        guestId: res.guestId,
        guestName: guest.name,
        guestEmail: guest.email,
        scheduledFor: `${date}T16:00:00`,
        context: { stayDuration: res.nights },
      });
    }

    return { date, propertyId, triggers };
  }

  /**
   * Housekeeping optimization hints — priority ordering and staffing.
   */
  async getHousekeepingInsights(propertyId: string, date: string) {
    // Get today's housekeeping tasks
    const tasks = await this.db
      .select()
      .from(housekeepingTasks)
      .where(
        and(
          eq(housekeepingTasks.propertyId, propertyId),
          sql`${housekeepingTasks.serviceDate}::date = ${date}`,
        ),
      );

    // Get arrivals for today (to prioritize their rooms)
    const arrivals = await this.db
      .select()
      .from(reservations)
      .where(
        and(
          eq(reservations.propertyId, propertyId),
          eq(reservations.arrivalDate, date),
          sql`${reservations.status} IN ('confirmed', 'assigned')`,
        ),
      );

    const arrivalRoomIds = new Set(arrivals.map((a: any) => a.roomId).filter(Boolean));

    // Build priority rooms list
    const priorityRooms = [];
    let suggestedOrder = 1;

    for (const task of tasks) {
      // Determine priority
      let priority = 5; // Default
      let reason = 'Scheduled task';

      if (arrivalRoomIds.has(task.roomId)) {
        priority = 1;
        reason = 'Guest arriving today';
      } else if (task.type === 'deep_clean') {
        priority = 2;
        reason = 'Deep clean required';
      } else if (task.status === 'pending') {
        priority = 3;
        reason = 'Pending task';
      }

      priorityRooms.push({
        roomId: task.roomId,
        roomNumber: task.roomId, // Will be resolved with room lookup
        taskType: task.type,
        priority,
        reason,
        suggestedOrder: suggestedOrder++,
      });
    }

    // Sort by priority
    priorityRooms.sort((a, b) => a.priority - b.priority);
    priorityRooms.forEach((r, i) => (r.suggestedOrder = i + 1));

    // Staffing hints
    const targetTurnTime = 30; // 30 minutes per KB
    const estimatedTaskCount = tasks.length;
    const estimatedMinutes = estimatedTaskCount * targetTurnTime;
    const shiftHours = 8;
    const suggestedStaffCount = Math.max(1, Math.ceil(estimatedMinutes / (shiftHours * 60)));

    // Current avg turn time from completed tasks
    const completedTasks = tasks.filter((t: any) => t.status === 'completed' && t.completedAt && t.startedAt);
    const avgTurnTime = completedTasks.length > 0
      ? completedTasks.reduce((sum: number, t: any) => {
          const duration = (new Date(t.completedAt).getTime() - new Date(t.startedAt).getTime()) / (1000 * 60);
          return sum + duration;
        }, 0) / completedTasks.length
      : targetTurnTime;

    return {
      date,
      propertyId,
      priorityRooms,
      estimatedTaskCount,
      estimatedMinutes,
      suggestedStaffCount,
      currentAvgTurnTime: Math.round(avgTurnTime),
      targetTurnTime,
    };
  }

  // --- Private ---

  private generateRevenueSuggestions(
    occupancyRate: number,
    adr: number,
    roomsAvailable: number,
    totalRooms: number,
  ) {
    const suggestions: Array<{
      type: string;
      reason: string;
      confidence: 'low' | 'medium' | 'high';
      details: Record<string, unknown>;
    }> = [];

    if (occupancyRate > 95) {
      suggestions.push({
        type: 'stop_sell',
        reason: 'Near sold-out — consider stop-sell on discount channels to maximize RevPAR.',
        confidence: 'high',
        details: { occupancyRate, roomsAvailable },
      });
    }

    if (occupancyRate > 90) {
      suggestions.push({
        type: 'rate_increase',
        reason: 'High demand — consider raising BAR by 10-15%.',
        confidence: 'high',
        details: { occupancyRate, suggestedIncrease: '10-15%', currentAdr: adr },
      });
    }

    if (occupancyRate < 40) {
      suggestions.push({
        type: 'rate_decrease',
        reason: 'Low demand — consider promotional rate or flash sale.',
        confidence: 'medium',
        details: { occupancyRate, roomsAvailable, suggestedDiscount: '15-25%' },
      });
    }

    if (occupancyRate < 40 && roomsAvailable > totalRooms * 0.5) {
      suggestions.push({
        type: 'open_channel',
        reason: 'Low occupancy — consider opening high-commission OTA channels to fill rooms.',
        confidence: 'low',
        details: { occupancyRate, roomsAvailable },
      });
    }

    return suggestions;
  }

  private async getGuestInfo(guestId: string) {
    const { guests } = await import('@inhotel-io/database');
    const [guest] = await this.db
      .select()
      .from(guests)
      .where(eq(guests.id, guestId));

    return {
      name: guest ? `${guest.firstName} ${guest.lastName}` : 'Unknown',
      email: guest?.email ?? undefined,
    };
  }

  private emptyRevenueInsights(propertyId: string, date: string) {
    return {
      date,
      propertyId,
      occupancyRate: 0,
      adr: 0,
      revpar: 0,
      roomsAvailable: 0,
      roomsSold: 0,
      reservationsToday: 0,
      cancellationsToday: 0,
      currentBarRate: 0,
      barRatePlanId: undefined,
      suggestions: [],
    };
  }

  private addDays(date: string, days: number): string {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d.toISOString().split('T')[0]!;
  }
}
