// Modified by inHotel Sàrl for inPMS; see NOTICE for upstream provenance.
import { Injectable, Inject, OnModuleInit } from '@nestjs/common';
import { eq, and, gte, lte, sql, not, inArray } from 'drizzle-orm';
import { reservations, rooms, roomTypes, agentConfigs, agentDecisions } from '@inhotel-io/database';
import { DRIZZLE } from '../../../database/database.module';
import { AgentService } from '../agent.service';
import type {
  HaipAgent,
  AgentContext,
  AgentAnalysis,
  AgentDecisionInput,
  AgentDecisionRecord,
  ExecutionResult,
  AgentOutcome,
  TrainingResult,
} from '../interfaces/haip-agent.interface';
import {
  heuristicForecast,
  statisticalForecast,
  selectModel,
  type HistoricalDay,
  type DayForecast,
} from './demand.models';

@Injectable()
export class DemandForecastAgent implements HaipAgent, OnModuleInit {
  readonly agentType = 'demand_forecast';

  constructor(
    @Inject(DRIZZLE) private readonly db: any,
    private readonly agentService: AgentService,
  ) {}

  onModuleInit() {
    this.agentService.registerAgent(this);
  }

  async analyze(propertyId: string, _context?: AgentContext): Promise<AgentAnalysis> {
    // Gather historical occupancy data
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 365);
    const startDate = ninetyDaysAgo.toISOString().split('T')[0]!;

    // Get all reservations for historical analysis
    const historicalReservations = await this.db
      .select({
        arrivalDate: reservations.arrivalDate,
        departureDate: reservations.departureDate,
        totalAmount: reservations.totalAmount,
        status: reservations.status,
        roomTypeId: reservations.roomTypeId,
      })
      .from(reservations)
      .where(
        and(
          eq(reservations.propertyId, propertyId),
          gte(reservations.arrivalDate, startDate),
          not(inArray(reservations.status, ['cancelled'] as any)),
        ),
      );

    // Get total rooms by type
    const roomCounts = await this.db
      .select({
        roomTypeId: rooms.roomTypeId,
        count: sql<number>`count(*)::int`,
      })
      .from(rooms)
      .where(eq(rooms.propertyId, propertyId))
      .groupBy(rooms.roomTypeId);

    const totalRooms = roomCounts.reduce((s: number, r: any) => s + r.count, 0);

    // Build historical day data
    const history = this.buildHistoricalDays(historicalReservations, totalRooms);

    // Get on-the-books for future dates
    const today = new Date().toISOString().split('T')[0]!;
    const futureEnd = new Date();
    futureEnd.setDate(futureEnd.getDate() + 90);
    const futureEndStr = futureEnd.toISOString().split('T')[0]!;

    const futureReservations = await this.db
      .select({
        arrivalDate: reservations.arrivalDate,
        departureDate: reservations.departureDate,
      })
      .from(reservations)
      .where(
        and(
          eq(reservations.propertyId, propertyId),
          gte(reservations.arrivalDate, today),
          lte(reservations.arrivalDate, futureEndStr),
          not(inArray(reservations.status, ['cancelled'] as any)),
        ),
      );

    // Count on-the-books per future date — expand across all occupied nights
    const otb = new Map<string, number>();
    for (const res of futureReservations) {
      const arrival = new Date(res.arrivalDate as string);
      const departure = res.departureDate ? new Date(res.departureDate as string) : new Date(arrival.getTime() + 86400000);
      const nights = Math.max(1, Math.ceil((departure.getTime() - arrival.getTime()) / 86400000));

      for (let n = 0; n < nights; n++) {
        const d = new Date(arrival);
        d.setDate(d.getDate() + n);
        const dateStr = d.toISOString().split('T')[0]!;
        otb.set(dateStr, (otb.get(dateStr) ?? 0) + 1);
      }
    }

    return {
      agentType: this.agentType,
      propertyId,
      timestamp: new Date(),
      signals: {
        history,
        totalRooms,
        onTheBooks: Object.fromEntries(otb),
        historyDays: history.length,
        modelType: selectModel(history.length),
      },
    };
  }

  async recommend(analysis: AgentAnalysis): Promise<AgentDecisionInput[]> {
    const { history, totalRooms, onTheBooks, modelType } =
      analysis.signals as {
        history: HistoricalDay[];
        totalRooms: number;
        onTheBooks: Record<string, number>;
        modelType: 'heuristic' | 'statistical';
      };

    const forecastFn = modelType === 'statistical' ? statisticalForecast : heuristicForecast;

    // Generate 90-day forecast
    const forecasts: DayForecast[] = [];
    const today = new Date();

    for (let i = 0; i < 90; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() + i);
      const dateStr = d.toISOString().split('T')[0]!;
      const otb = onTheBooks[dateStr] ?? 0;

      forecasts.push(forecastFn(history, dateStr, otb, totalRooms));
    }

    return [
      {
        decisionType: 'demand_forecast',
        recommendation: {
          forecastHorizon: 90,
          modelType,
          forecasts,
          summary: {
            avgOccupancy: forecasts.reduce((s, f) => s + f.predictedOccupancy, 0) / forecasts.length,
            peakDates: forecasts.filter((f) => f.demandLevel === 'peak').map((f) => f.date),
            lowDates: forecasts.filter((f) => f.demandLevel === 'low').map((f) => f.date),
          },
        },
        confidence: forecasts.reduce((s, f) => s + f.confidence, 0) / forecasts.length,
        inputSnapshot: {
          historyDays: history.length,
          totalRooms,
          modelType,
          analyzedAt: analysis.timestamp.toISOString(),
        },
      },
    ];
  }

  async execute(_decision: AgentDecisionRecord): Promise<ExecutionResult> {
    // Demand forecast is informational — no direct execution
    return {
      success: true,
      changes: [{ entity: 'forecast', action: 'published', detail: '90-day forecast updated' }],
    };
  }

  async recordOutcome(decisionId: string, outcome: AgentOutcome): Promise<void> {
    // Outcome recording handled by AgentService
  }

  async train(propertyId: string): Promise<TrainingResult> {
    // Run analysis to build training data
    const analysis = await this.analyze(propertyId);
    const history = analysis.signals['history'] as HistoricalDay[];

    return {
      success: true,
      dataPoints: history.length,
      modelVersion: selectModel(history.length),
      metrics: {
        historyDays: history.length,
      },
    };
  }

  getDefaultConfig(): Record<string, unknown> {
    return {
      forecastHorizonDays: 90,
      // No independent cron — runs via RManager (manual still allowed).
      runScheduleCron: '',
    };
  }

  // --- Private ---

  private buildHistoricalDays(
    reservationData: Array<{ arrivalDate: string; departureDate?: string; totalAmount: string; status: string }>,
    totalRooms: number,
  ): HistoricalDay[] {
    // Group reservations by each occupied night in [arrivalDate, departureDate)
    const byDate = new Map<string, { count: number; totalRevenue: number }>();

    for (const res of reservationData) {
      const arrival = new Date(res.arrivalDate);
      const departure = res.departureDate ? new Date(res.departureDate) : new Date(arrival.getTime() + 86400000);
      const nights = Math.max(1, Math.ceil((departure.getTime() - arrival.getTime()) / 86400000));
      const revenuePerNight = parseFloat(res.totalAmount ?? '0') / nights;

      for (let n = 0; n < nights; n++) {
        const d = new Date(arrival);
        d.setDate(d.getDate() + n);
        const date = d.toISOString().split('T')[0]!;
        const existing = byDate.get(date) ?? { count: 0, totalRevenue: 0 };
        existing.count++;
        existing.totalRevenue += revenuePerNight;
        byDate.set(date, existing);
      }
    }

    return [...byDate.entries()].map(([date, data]) => {
      const d = new Date(date);
      return {
        date,
        dayOfWeek: d.getDay(),
        occupancy: totalRooms > 0 ? Math.min(1, data.count / totalRooms) : 0,
        adr: data.count > 0 ? data.totalRevenue / data.count : 0,
        bookings: data.count,
      };
    });
  }
}
