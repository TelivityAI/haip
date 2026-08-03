// Modified by inHotel Sàrl for inPMS; see NOTICE for upstream provenance.
import { Injectable, Inject, OnModuleInit } from '@nestjs/common';
import { eq, and, gte, lte, not, inArray, desc } from 'drizzle-orm';
import { reservations, rooms, agentDecisions } from '@inhotel-io/database';
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
import { calculateOverbookingLevel, type OverbookingConfig, type OverbookingRecommendation } from './overbooking.models';

@Injectable()
export class OverbookingAgent implements HaipAgent, OnModuleInit {
  readonly agentType = 'overbooking';

  constructor(
    @Inject(DRIZZLE) private readonly db: any,
    private readonly agentService: AgentService,
  ) {}

  onModuleInit() {
    this.agentService.registerAgent(this);
  }

  async analyze(propertyId: string, _context?: AgentContext): Promise<AgentAnalysis> {
    const config = await this.agentService.getOrCreateConfig(propertyId, this.agentType);
    const obConfig: OverbookingConfig = {
      maxWalkProbability: (config.config as any)?.maxWalkProbability ?? 0.05,
      walkCost: (config.config as any)?.walkCost ?? 150,
      guaranteedNoShowRate: (config.config as any)?.guaranteedNoShowRate ?? 0.02,
      nonGuaranteedNoShowRate: (config.config as any)?.nonGuaranteedNoShowRate ?? 0.10,
      minOccupancyToActivate: (config.config as any)?.minOccupancyToActivate ?? 0.85,
    };

    // Get total room count
    const roomList = await this.db
      .select()
      .from(rooms)
      .where(eq(rooms.propertyId, propertyId));
    const totalRooms = roomList.length;

    // Get on-the-books for next 14 days
    const today = new Date().toISOString().split('T')[0]!;
    const futureEnd = new Date();
    futureEnd.setDate(futureEnd.getDate() + 14);
    const futureEndStr = futureEnd.toISOString().split('T')[0]!;

    // Pull any reservation whose stay overlaps the next-14-day window.
    // A reservation arriving day -3 and departing day +1 occupies the target dates from day 0 to day 0.
    const futureRes = await this.db
      .select({
        arrivalDate: reservations.arrivalDate,
        departureDate: reservations.departureDate,
        status: reservations.status,
      })
      .from(reservations)
      .where(
        and(
          eq(reservations.propertyId, propertyId),
          lte(reservations.arrivalDate, futureEndStr),
          gte(reservations.departureDate, today),
          not(inArray(reservations.status, ['cancelled'] as any)),
        ),
      );

    // Expand each reservation across every occupied night [arrivalDate, departureDate)
    // so counts reflect all stayovers, not just arrivals.
    const otb = new Map<string, number>();
    const windowStart = new Date(today);
    const windowEnd = new Date(futureEndStr);
    for (const r of futureRes) {
      const arrival = new Date(r.arrivalDate as string);
      const departure = r.departureDate ? new Date(r.departureDate as string) : new Date(arrival.getTime() + 86400000);
      const nights = Math.max(1, Math.ceil((departure.getTime() - arrival.getTime()) / 86400000));
      for (let n = 0; n < nights; n++) {
        const d = new Date(arrival);
        d.setDate(d.getDate() + n);
        if (d < windowStart || d > windowEnd) continue;
        const dateStr = d.toISOString().split('T')[0]!;
        otb.set(dateStr, (otb.get(dateStr) ?? 0) + 1);
      }
    }

    // Historical no-show rate
    const historicalRes = await this.db
      .select({ status: reservations.status })
      .from(reservations)
      .where(eq(reservations.propertyId, propertyId));

    const totalHistorical = historicalRes.length;
    const noShowCount = historicalRes.filter((r: any) => r.status === 'no_show').length;
    const cancelCount = historicalRes.filter((r: any) => r.status === 'cancelled').length;

    const noShowRate = totalHistorical > 0 ? noShowCount / totalHistorical : obConfig.nonGuaranteedNoShowRate;
    const cancelRate = totalHistorical > 0 ? cancelCount / totalHistorical : 0.10;

    // Get demand forecast
    const [latestForecast] = await this.db
      .select()
      .from(agentDecisions)
      .where(
        and(
          eq(agentDecisions.propertyId, propertyId),
          eq(agentDecisions.agentType, 'demand_forecast' as any),
        ),
      )
      .orderBy(desc(agentDecisions.createdAt))
      .limit(1);

    const forecasts = (latestForecast?.recommendation as any)?.forecasts ?? [];

    return {
      agentType: this.agentType,
      propertyId,
      timestamp: new Date(),
      signals: {
        totalRooms,
        onTheBooks: Object.fromEntries(otb),
        noShowRate,
        cancelRate,
        obConfig,
        forecasts,
      },
    };
  }

  async recommend(analysis: AgentAnalysis): Promise<AgentDecisionInput[]> {
    const { totalRooms, onTheBooks, noShowRate, cancelRate, obConfig, forecasts } =
      analysis.signals as {
        totalRooms: number;
        onTheBooks: Record<string, number>;
        noShowRate: number;
        cancelRate: number;
        obConfig: OverbookingConfig;
        forecasts: Array<{ date: string; predictedOccupancy: number; predictedAdr: number }>;
      };

    const recommendations: OverbookingRecommendation[] = [];
    const today = new Date();

    for (let i = 0; i < 14; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() + i);
      const dateStr = d.toISOString().split('T')[0]!;
      const otb = onTheBooks[dateStr] ?? 0;
      const occupancy = totalRooms > 0 ? otb / totalRooms : 0;

      // Only activate when occupancy exceeds threshold
      if (occupancy < obConfig.minOccupancyToActivate) continue;

      const forecast = forecasts.find((f: any) => f.date === dateStr);
      const adr = forecast?.predictedAdr ?? 150;

      const rec = calculateOverbookingLevel({
        totalRooms,
        onTheBooks: otb,
        noShowRate,
        cancellationRate: cancelRate,
        adr,
        walkCost: obConfig.walkCost,
        maxWalkProbability: obConfig.maxWalkProbability,
      });

      if (rec.recommendedOverbookCount > 0) {
        rec.date = dateStr;
        recommendations.push(rec);
      }
    }

    if (recommendations.length === 0) return [];

    const avgConfidence = recommendations.reduce((s, r) => s + r.confidence, 0) / recommendations.length;

    return [
      {
        decisionType: 'overbooking_level',
        recommendation: {
          levels: recommendations,
          summary: {
            datesAnalyzed: 14,
            datesWithOverbooking: recommendations.length,
            totalAdditionalRooms: recommendations.reduce((s, r) => s + r.recommendedOverbookCount, 0),
            maxWalkRisk: Math.max(...recommendations.map((r) => r.walkRisk)),
            totalExpectedValue: recommendations.reduce((s, r) => s + r.expectedValue, 0),
          },
        },
        confidence: avgConfidence,
        inputSnapshot: {
          totalRooms,
          historicalNoShowRate: noShowRate,
          historicalCancelRate: cancelRate,
          analyzedAt: analysis.timestamp.toISOString(),
        },
      },
    ];
  }

  async execute(_decision: AgentDecisionRecord): Promise<ExecutionResult> {
    // In full implementation: adjust room type availability ceiling
    return {
      success: true,
      changes: [{ entity: 'overbooking', action: 'updated', detail: 'Overbooking levels adjusted' }],
    };
  }

  async recordOutcome(_decisionId: string, _outcome: AgentOutcome): Promise<void> {}

  async train(_propertyId: string): Promise<TrainingResult> {
    return { success: true, dataPoints: 0, modelVersion: 'overbooking-v1', metrics: {} };
  }

  getDefaultConfig(): Record<string, unknown> {
    return {
      maxWalkProbability: 0.05,
      walkCost: 150,
      guaranteedNoShowRate: 0.02,
      nonGuaranteedNoShowRate: 0.10,
      minOccupancyToActivate: 0.85,
      // No independent cron — runs via RManager (manual still allowed).
      runScheduleCron: '',
    };
  }
}
