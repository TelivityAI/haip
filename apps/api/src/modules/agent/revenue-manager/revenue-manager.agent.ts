import { Injectable, Inject, OnModuleInit, Logger } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { ratePlans } from '@telivityhaip/database';
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
import { DynamicPricingAgent } from '../pricing/pricing.agent';
import { OverbookingAgent } from '../overbooking/overbooking.agent';
import { ChannelMixAgent } from '../channel-mix/channel-mix.agent';
import { GroupPickupAgent } from '../group-pickup/group-pickup.agent';
import {
  synthesizeStrategy,
  type ForecastInput,
  type RevenueObjective,
  type StrategySynthesisInput,
} from './revenue-manager.models';

/**
 * Revenue Manager (RManager) — the revenue orchestration agent.
 *
 * Where the other agents each own one lever (forecast, price, overbooking,
 * channel mix, group pickup), RManager is the meta-agent that runs them in
 * dependency order (demand first, then the levers that consume it) and reconciles
 * their outputs into ONE coherent revenue strategy, applying the RM knowledge
 * base's decision rules: optimize GOPPAR over raw revenue, move price with demand
 * and pace, protect peak dates with length-of-stay controls, keep the rate grid
 * consistent, evaluate group displacement on net contribution, and treat
 * discounting as a last resort.
 *
 * It is intentionally read-and-coordinate: each sub-agent still owns and executes
 * its own lever; RManager produces the unified plan and surfaces conflicts.
 */
@Injectable()
export class RevenueManagerAgent implements HaipAgent, OnModuleInit {
  readonly agentType = 'revenue_manager';
  private readonly logger = new Logger(RevenueManagerAgent.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: any,
    private readonly agentService: AgentService,
    private readonly demandAgent: DemandForecastAgent,
    private readonly pricingAgent: DynamicPricingAgent,
    private readonly overbookingAgent: OverbookingAgent,
    private readonly channelMixAgent: ChannelMixAgent,
    private readonly groupPickupAgent: GroupPickupAgent,
  ) {}

  onModuleInit() {
    this.agentService.registerAgent(this);
  }

  async analyze(propertyId: string, context?: AgentContext): Promise<AgentAnalysis> {
    const config = await this.agentService.getOrCreateConfig(propertyId, this.agentType);
    const cfg = (config.config as Record<string, unknown>) ?? {};
    const objective = (cfg['objective'] as RevenueObjective) ?? 'goppar';
    const horizonDays = (cfg['horizonDays'] as number) ?? 30;

    // 1. Demand forecast — the backbone every other lever consumes.
    const forecasts = await this.gatherForecasts(propertyId, horizonDays);

    // 2. Dynamic pricing — proposed per-date adjustments (best-effort).
    const pricingByDate = await this.gatherPricing(propertyId);

    // 3. Companion levers — gathered for context/conflict surfacing (best-effort,
    //    a failing sub-agent must not abort the orchestration).
    const overbooking = await this.safeRecommend('overbooking', () =>
      this.runLever(this.overbookingAgent, propertyId, context),
    );
    const channelMix = await this.safeRecommend('channel_mix', () =>
      this.runLever(this.channelMixAgent, propertyId, context),
    );
    const groupPickup = await this.safeRecommend('group_pickup', () =>
      this.runLever(this.groupPickupAgent, propertyId, context),
    );

    // Baseline ADR: configured, else mean of active rate-plan base amounts.
    const baselineAdr = (cfg['baselineAdr'] as number) ?? (await this.deriveBaselineAdr(propertyId));

    return {
      agentType: this.agentType,
      propertyId,
      timestamp: new Date(),
      signals: {
        objective,
        horizonDays,
        variableCostPerRoom: (cfg['variableCostPerRoom'] as number) ?? 25,
        fcpar: (cfg['fcpar'] as number) ?? 60,
        baselineAdr,
        forecasts,
        pricingByDate,
        leverSummaries: {
          overbooking: summarize(overbooking),
          channelMix: summarize(channelMix),
          groupPickup: summarize(groupPickup),
        },
      },
    };
  }

  async recommend(analysis: AgentAnalysis): Promise<AgentDecisionInput[]> {
    const s = analysis.signals as unknown as {
      objective: RevenueObjective;
      horizonDays: number;
      variableCostPerRoom: number;
      fcpar: number;
      baselineAdr: number;
      forecasts: ForecastInput[];
      pricingByDate: Record<string, number>;
      leverSummaries: Record<string, unknown>;
    };

    if (!s.forecasts || s.forecasts.length === 0) {
      return [];
    }

    const synthInput: StrategySynthesisInput = {
      objective: s.objective,
      variableCostPerRoom: s.variableCostPerRoom,
      fcpar: s.fcpar,
      baselineAdr: s.baselineAdr,
      forecasts: s.forecasts,
      pricingByDate: s.pricingByDate,
    };

    const strategy = synthesizeStrategy(synthInput);

    // Confidence: mean forecast confidence, dampened slightly because this is a
    // synthesis over several uncertain inputs.
    const meanConfidence =
      s.forecasts.reduce((acc, f) => acc + (f.confidence ?? 0.5), 0) / s.forecasts.length;
    const confidence = Math.round(Math.min(meanConfidence, 0.95) * 100) / 100;

    return [
      {
        decisionType: 'revenue_strategy',
        recommendation: {
          ...strategy,
          leverSummaries: s.leverSummaries,
        },
        confidence,
        inputSnapshot: {
          objective: s.objective,
          horizonDays: s.horizonDays,
          baselineAdr: s.baselineAdr,
          variableCostPerRoom: s.variableCostPerRoom,
          fcpar: s.fcpar,
          forecastDays: s.forecasts.length,
          analyzedAt: analysis.timestamp.toISOString(),
        },
      },
    ];
  }

  async execute(decision: AgentDecisionRecord): Promise<ExecutionResult> {
    const rec = decision.recommendation as any;
    const perDate = (rec?.perDate ?? []) as Array<{
      date: string;
      priceDirection: string;
      priceAdjustmentPct: number;
      losControl: string;
      overbooking: string;
    }>;
    const summary = rec?.summary ?? {};
    const changes: ExecutionResult['changes'] = [];

    // RManager coordinates; the individual levers own physical execution. Here we
    // record the authoritative coordinated plan (the levers' own executes apply
    // their slice). This keeps a single, auditable revenue-strategy record.
    changes.push({
      entity: 'revenue_strategy',
      action: 'publish',
      detail:
        `objective=${rec?.objective}; ${perDate.length} dates; ` +
        `${summary.raiseDates ?? 0}↑/${summary.holdDates ?? 0}=/${summary.lowerDates ?? 0}↓; ` +
        `MinLOS on ${summary.minLosDates ?? 0}; ` +
        `proj RevPAR=${summary.projectedRevPAR}, GOPPAR=${summary.projectedGOPPAR}`,
    });

    for (const d of perDate.filter((x) => x.losControl !== 'none' || x.overbooking !== 'standard')) {
      changes.push({
        entity: 'date_control',
        action: 'set',
        detail: `${d.date}: price ${d.priceDirection} ${d.priceAdjustmentPct}%, LOS=${d.losControl}, overbooking=${d.overbooking}`,
      });
    }

    return { success: true, changes };
  }

  async recordOutcome(_decisionId: string, _outcome: AgentOutcome): Promise<void> {
    // Outcome persistence is handled by AgentService; the synthesis is stateless.
  }

  async train(_propertyId: string): Promise<TrainingResult> {
    // RManager has no model of its own — its sub-agents are trained individually.
    return { success: true, dataPoints: 0, modelVersion: 'revenue-manager-v1', metrics: {} };
  }

  getDefaultConfig(): Record<string, unknown> {
    return {
      objective: 'goppar', // optimize profit per available room, not revenue alone
      variableCostPerRoom: 25, // VC1 — mid of the typical $10–$40 housekeeping range
      fcpar: 60, // fixed cost per available room
      baselineAdr: null, // null → derive from active rate plans
      horizonDays: 30,
      runScheduleCron: '0 6 * * *', // daily at 06:00
    };
  }

  // --- private ---

  /** Run demand agent fresh and normalize to ForecastInput[]. */
  private async gatherForecasts(propertyId: string, horizonDays: number): Promise<ForecastInput[]> {
    const result = await this.safeRecommend('demand_forecast', () =>
      this.runLever(this.demandAgent, propertyId),
    );
    const rec = result?.[0]?.recommendation as any;
    const forecasts: any[] = rec?.forecasts ?? [];
    return forecasts.slice(0, horizonDays).map((f) => ({
      date: f.date,
      predictedOccupancy: f.predictedOccupancy,
      confidence: f.confidence ?? 0.5,
    }));
  }

  /** Run pricing agent fresh and collapse per-plan adjustments into a per-date mean. */
  private async gatherPricing(propertyId: string): Promise<Record<string, number>> {
    const result = await this.safeRecommend('pricing', () =>
      this.runLever(this.pricingAgent, propertyId),
    );
    const adjustments: any[] = (result?.[0]?.recommendation as any)?.adjustments ?? [];
    const byDate = new Map<string, { sum: number; n: number }>();
    for (const a of adjustments) {
      const cur = byDate.get(a.date) ?? { sum: 0, n: 0 };
      cur.sum += a.adjustmentPct ?? 0;
      cur.n += 1;
      byDate.set(a.date, cur);
    }
    const out: Record<string, number> = {};
    for (const [date, { sum, n }] of byDate) out[date] = n > 0 ? sum / n : 0;
    return out;
  }

  private async runLever(
    agent: HaipAgent,
    propertyId: string,
    context?: AgentContext,
  ): Promise<AgentDecisionInput[]> {
    const analysis = await agent.analyze(propertyId, context);
    return agent.recommend(analysis);
  }

  /** Wrap a sub-agent invocation so one failing lever can't abort orchestration. */
  private async safeRecommend(
    name: string,
    fn: () => Promise<AgentDecisionInput[]>,
  ): Promise<AgentDecisionInput[] | null> {
    try {
      return await fn();
    } catch (err: any) {
      this.logger.warn(`Sub-agent '${name}' failed during orchestration: ${err?.message ?? err}`);
      return null;
    }
  }

  private async deriveBaselineAdr(propertyId: string): Promise<number> {
    const plans = await this.db
      .select({ baseAmount: ratePlans.baseAmount })
      .from(ratePlans)
      .where(and(eq(ratePlans.propertyId, propertyId), eq(ratePlans.isActive, true)));
    const rates = plans
      .map((p: any) => parseFloat(p.baseAmount))
      .filter((r: number) => Number.isFinite(r) && r > 0);
    if (rates.length === 0) return 120; // sensible default until rate plans exist
    return Math.round(rates.reduce((s: number, r: number) => s + r, 0) / rates.length);
  }
}

function summarize(recs: AgentDecisionInput[] | null): Record<string, unknown> {
  if (!recs || recs.length === 0) return { available: false };
  return {
    available: true,
    decisionType: recs[0]!.decisionType,
    confidence: recs[0]!.confidence,
  };
}
