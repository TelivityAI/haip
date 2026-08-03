// Modified by inHotel Sàrl for inPMS; see NOTICE for upstream provenance.
import { Injectable, Inject, OnModuleInit } from '@nestjs/common';
import { eq, and, desc } from 'drizzle-orm';
import { ratePlans, agentDecisions } from '@inhotel-io/database';
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
import { DemandForecastAgent } from '../demand/demand.agent';
import { calculateRecommendedRate, type PricingConfig, type RateRecommendation } from './pricing.models';

@Injectable()
export class DynamicPricingAgent implements HaipAgent, OnModuleInit {
  readonly agentType = 'pricing';

  constructor(
    @Inject(DRIZZLE) private readonly db: any,
    private readonly agentService: AgentService,
    private readonly demandAgent: DemandForecastAgent,
  ) {}

  onModuleInit() {
    this.agentService.registerAgent(this);
  }

  async analyze(propertyId: string, _context?: AgentContext): Promise<AgentAnalysis> {
    // Get latest demand forecast
    const [latestForecast] = await this.db
      .select()
      .from(agentDecisions)
      .where(
        and(
          eq(agentDecisions.propertyId, propertyId),
          eq(agentDecisions.agentType, 'demand_forecast' as any),
          eq(agentDecisions.decisionType, 'demand_forecast'),
        ),
      )
      .orderBy(desc(agentDecisions.createdAt))
      .limit(1);

    // If no forecast exists, run demand agent first
    let forecasts: any[] = [];
    if (latestForecast?.recommendation) {
      forecasts = (latestForecast.recommendation as any).forecasts ?? [];
    }

    // Get active rate plans
    const activeRatePlans = await this.db
      .select()
      .from(ratePlans)
      .where(
        and(
          eq(ratePlans.propertyId, propertyId),
          eq(ratePlans.isActive, true),
        ),
      );

    // Get agent config
    const config = await this.agentService.getOrCreateConfig(propertyId, this.agentType);
    const pricingConfig: PricingConfig = {
      floorRates: (config.config as any)?.floorRates ?? {},
      ceilingRates: (config.config as any)?.ceilingRates ?? {},
      maxAdjustmentPct: (config.config as any)?.maxAdjustmentPct ?? 30,
      revparTarget: (config.config as any)?.revparTarget ?? 120,
      weekendPremiumPct: (config.config as any)?.weekendPremiumPct ?? 15,
      pricingHorizonDays: (config.config as any)?.pricingHorizonDays ?? 30,
    };

    return {
      agentType: this.agentType,
      propertyId,
      timestamp: new Date(),
      signals: {
        forecasts,
        ratePlans: activeRatePlans,
        pricingConfig,
      },
    };
  }

  async recommend(analysis: AgentAnalysis): Promise<AgentDecisionInput[]> {
    const { forecasts, ratePlans: plans, pricingConfig } = analysis.signals as {
      forecasts: Array<{
        date: string;
        predictedOccupancy: number;
        demandLevel: string;
        confidence: number;
        drivers: string[];
      }>;
      ratePlans: Array<{
        id: string;
        roomTypeId: string;
        baseAmount: string;
        name: string;
      }>;
      pricingConfig: PricingConfig;
    };

    const recommendations: RateRecommendation[] = [];
    const horizonDays = pricingConfig.pricingHorizonDays;

    // Use only forecasts within pricing horizon
    const relevantForecasts = forecasts.slice(0, horizonDays);

    for (const plan of plans) {
      const baseRate = parseFloat(plan.baseAmount);
      if (baseRate <= 0) continue;

      const floorRate = pricingConfig.floorRates[plan.id] ?? baseRate * 0.6;
      const ceilingRate = pricingConfig.ceilingRates[plan.id] ?? baseRate * 3;

      for (const forecast of relevantForecasts) {
        const d = new Date(forecast.date);
        const daysOut = Math.max(1, Math.ceil((d.getTime() - Date.now()) / 86400000));
        const isWeekend = d.getDay() === 5 || d.getDay() === 6;

        const result = calculateRecommendedRate({
          baseRate,
          predictedOccupancy: forecast.predictedOccupancy,
          currentBookingPace: 1.0, // default until booking pace data accumulates
          daysOut,
          isWeekend,
          floorRate,
          ceilingRate,
          maxAdjustmentPct: pricingConfig.maxAdjustmentPct,
          weekendPremiumPct: pricingConfig.weekendPremiumPct,
        });

        // Only recommend if there's a meaningful change
        if (Math.abs(result.adjustmentPct) >= 2) {
          recommendations.push({
            roomTypeId: plan.roomTypeId,
            ratePlanId: plan.id,
            date: forecast.date,
            currentRate: baseRate,
            recommendedRate: result.rate,
            adjustmentPct: result.adjustmentPct,
            reason: result.reason,
            estimatedRevenueImpact: (result.rate - baseRate) * forecast.predictedOccupancy * 10, // rough estimate
          });
        }
      }
    }

    if (recommendations.length === 0) {
      return [];
    }

    // Average confidence from forecasts
    const avgConfidence = relevantForecasts.length > 0
      ? relevantForecasts.reduce((s, f) => s + f.confidence, 0) / relevantForecasts.length
      : 0.5;

    return [
      {
        decisionType: 'rate_adjustment',
        recommendation: {
          adjustments: recommendations,
          summary: {
            totalAdjustments: recommendations.length,
            avgAdjustmentPct:
              recommendations.reduce((s, r) => s + Math.abs(r.adjustmentPct), 0) /
              recommendations.length,
            estimatedRevenueImpact: recommendations.reduce(
              (s, r) => s + r.estimatedRevenueImpact,
              0,
            ),
          },
        },
        confidence: Math.round(avgConfidence * 100) / 100,
        inputSnapshot: {
          ratePlanCount: plans.length,
          forecastDays: relevantForecasts.length,
          analyzedAt: analysis.timestamp.toISOString(),
        },
      },
    ];
  }

  async execute(decision: AgentDecisionRecord): Promise<ExecutionResult> {
    const adjustments = (decision.recommendation as any)?.adjustments as RateRecommendation[] ?? [];
    const changes: ExecutionResult['changes'] = [];

    // Note: In a full implementation, this would update rate plan amounts
    // and trigger ARI push to channels. For now, log the intended changes.
    for (const adj of adjustments) {
      changes.push({
        entity: 'rate_plan',
        action: 'adjust',
        detail: `${adj.ratePlanId} on ${adj.date}: $${adj.currentRate} → $${adj.recommendedRate} (${adj.adjustmentPct > 0 ? '+' : ''}${adj.adjustmentPct}%)`,
      });
    }

    return { success: true, changes };
  }

  async recordOutcome(_decisionId: string, _outcome: AgentOutcome): Promise<void> {
    // Outcome recording handled by AgentService
  }

  async train(propertyId: string): Promise<TrainingResult> {
    return {
      success: true,
      dataPoints: 0,
      modelVersion: 'pricing-v1',
      metrics: {},
    };
  }

  getDefaultConfig(): Record<string, unknown> {
    return {
      floorRates: {},
      ceilingRates: {},
      maxAdjustmentPct: 30,
      revparTarget: 120,
      weekendPremiumPct: 15,
      pricingHorizonDays: 30,
      // No independent cron — runs via RManager (manual still allowed).
      runScheduleCron: '',
    };
  }
}
