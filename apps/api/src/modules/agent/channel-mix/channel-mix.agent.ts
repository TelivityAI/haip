import { Injectable, Inject, OnModuleInit } from '@nestjs/common';
import { eq, and, desc } from 'drizzle-orm';
import { channelConnections, bookings, reservations, agentDecisions } from '@telivityhaip/database';
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
  calculateNetRevenue,
  recommendChannelAllocation,
  type ChannelMetrics,
} from './channel-mix.models';

@Injectable()
export class ChannelMixAgent implements HaipAgent, OnModuleInit {
  readonly agentType = 'channel_mix';

  constructor(
    @Inject(DRIZZLE) private readonly db: any,
    private readonly agentService: AgentService,
  ) {}

  onModuleInit() {
    this.agentService.registerAgent(this);
  }

  async analyze(propertyId: string, _context?: AgentContext): Promise<AgentAnalysis> {
    // Get channel connections with commission config
    const connections = await this.db
      .select()
      .from(channelConnections)
      .where(
        and(
          eq(channelConnections.propertyId, propertyId),
          eq(channelConnections.isActive, true),
        ),
      );

    // Get booking counts and revenue by channel
    const channelBookings = await this.db
      .select({
        channelCode: bookings.channelCode,
        totalAmount: reservations.totalAmount,
        status: reservations.status,
      })
      .from(bookings)
      .innerJoin(reservations, eq(reservations.bookingId, bookings.id))
      .where(eq(bookings.propertyId, propertyId));

    // Build channel metrics
    const channelMap = new Map<string, { count: number; revenue: number; cancelCount: number }>();
    for (const b of channelBookings) {
      const code = (b.channelCode as string) ?? 'direct';
      const existing = channelMap.get(code) ?? { count: 0, revenue: 0, cancelCount: 0 };
      existing.count++;
      existing.revenue += parseFloat(b.totalAmount ?? '0');
      if (b.status === 'cancelled') existing.cancelCount++;
      channelMap.set(code, existing);
    }

    const channelMetrics: ChannelMetrics[] = [];
    for (const conn of connections) {
      const stats = channelMap.get(conn.channelCode) ?? { count: 0, revenue: 0, cancelCount: 0 };
      const config = (conn.config ?? {}) as Record<string, unknown>;
      const commissionRate = (config['commissionRate'] as number) ?? 0.15;
      const cancelRate = stats.count > 0 ? stats.cancelCount / stats.count : 0.10;
      const avgRate = stats.count > 0 ? stats.revenue / stats.count : 150;

      channelMetrics.push({
        channelCode: conn.channelCode,
        channelName: conn.channelName,
        commissionRate,
        cancellationRate: cancelRate,
        avgRate,
        bookingCount: stats.count,
        netRevPerRoom: calculateNetRevenue(avgRate, commissionRate, cancelRate),
      });
    }

    // Add direct channel
    const directStats = channelMap.get('direct') ?? { count: 0, revenue: 0, cancelCount: 0 };
    const directAvgRate = directStats.count > 0 ? directStats.revenue / directStats.count : 150;
    const directCancelRate = directStats.count > 0 ? directStats.cancelCount / directStats.count : 0.03;
    channelMetrics.push({
      channelCode: 'direct',
      channelName: 'Direct Booking',
      commissionRate: 0,
      cancellationRate: directCancelRate,
      avgRate: directAvgRate,
      bookingCount: directStats.count,
      netRevPerRoom: calculateNetRevenue(directAvgRate, 0, directCancelRate),
    });

    // Get latest demand forecast for occupancy
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
      signals: { channelMetrics, forecasts, totalConnections: connections.length },
    };
  }

  async recommend(analysis: AgentAnalysis): Promise<AgentDecisionInput[]> {
    const { channelMetrics, forecasts } = analysis.signals as {
      channelMetrics: ChannelMetrics[];
      forecasts: Array<{ date: string; predictedOccupancy: number }>;
    };

    if (channelMetrics.length === 0) return [];

    // Use average predicted occupancy for next 7 days
    const next7 = forecasts.slice(0, 7);
    const avgOccupancy = next7.length > 0
      ? next7.reduce((s, f) => s + f.predictedOccupancy, 0) / next7.length
      : 0.5;

    const allocations = recommendChannelAllocation(channelMetrics, avgOccupancy, 100);

    const stopSellCount = allocations.filter((a) => a.stopSell).length;

    return [
      {
        decisionType: 'channel_allocation',
        recommendation: {
          allocations,
          predictedOccupancy: avgOccupancy,
          netRevenueRanking: channelMetrics
            .sort((a, b) => b.netRevPerRoom - a.netRevPerRoom)
            .map((c) => ({
              channel: c.channelCode,
              netRevPerRoom: Math.round(c.netRevPerRoom),
              grossRate: Math.round(c.avgRate),
              commission: `${(c.commissionRate * 100).toFixed(0)}%`,
            })),
          summary: {
            channelsAnalyzed: channelMetrics.length,
            stopSellRecommendations: stopSellCount,
            directBookingOpportunity: stopSellCount > 0,
          },
        },
        confidence: Math.min(0.8, 0.4 + channelMetrics.reduce((s, c) => s + c.bookingCount, 0) * 0.002),
        inputSnapshot: {
          channelCount: channelMetrics.length,
          avgOccupancy,
          analyzedAt: analysis.timestamp.toISOString(),
        },
      },
    ];
  }

  async execute(_decision: AgentDecisionRecord): Promise<ExecutionResult> {
    // In full implementation: push stop-sells and availability changes via ChannelService
    return {
      success: true,
      changes: [{ entity: 'channel_allocation', action: 'updated', detail: 'Channel mix optimized' }],
    };
  }

  async recordOutcome(_decisionId: string, _outcome: AgentOutcome): Promise<void> {}

  async train(_propertyId: string): Promise<TrainingResult> {
    return { success: true, dataPoints: 0, modelVersion: 'channel-mix-v1', metrics: {} };
  }

  getDefaultConfig(): Record<string, unknown> {
    return {
      commissionRates: {},
      stopSellOccupancyThreshold: 0.80,
      // No independent cron — runs via RManager (manual still allowed).
      runScheduleCron: '',
    };
  }
}
