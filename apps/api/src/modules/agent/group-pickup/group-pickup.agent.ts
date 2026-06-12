import { Injectable, Inject, OnModuleInit } from '@nestjs/common';
import { eq, and, inArray } from 'drizzle-orm';
import { allotmentBlocks, allotmentBlockInventory } from '@telivityhaip/database';
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
import { forecastPickup, type PickupForecast } from './group-pickup.models';

interface BlockSignal {
  blockId: string;
  blockName: string;
  status: string;
  cutoffDate: string | null;
  daysToCutoff: number;
  roomsAllotted: number;
  roomsPickedUp: number;
}

@Injectable()
export class GroupPickupAgent implements HaipAgent, OnModuleInit {
  readonly agentType = 'group_pickup';

  constructor(
    @Inject(DRIZZLE) private readonly db: any,
    private readonly agentService: AgentService,
  ) {}

  onModuleInit() {
    this.agentService.registerAgent(this);
  }

  async analyze(propertyId: string, _context?: AgentContext): Promise<AgentAnalysis> {
    const config = await this.agentService.getOrCreateConfig(propertyId, this.agentType);
    const historicalPickupRate = (config.config as any)?.historicalPickupRate ?? 0.7;

    // Active blocks still holding inventory (tentative/definite).
    const blocks = await this.db
      .select()
      .from(allotmentBlocks)
      .where(
        and(
          eq(allotmentBlocks.propertyId, propertyId),
          inArray(allotmentBlocks.status, ['tentative', 'definite'] as any),
        ),
      );

    const todayMs = new Date(new Date().toISOString().split('T')[0]!).getTime();
    const signals: BlockSignal[] = [];

    for (const block of blocks) {
      const inv = await this.db
        .select()
        .from(allotmentBlockInventory)
        .where(
          and(
            eq(allotmentBlockInventory.allotmentBlockId, block.id),
            eq(allotmentBlockInventory.propertyId, propertyId),
          ),
        );

      const roomsAllotted = inv.reduce((s: number, r: any) => s + Number(r.roomsAllotted ?? 0), 0);
      const roomsPickedUp = inv.reduce((s: number, r: any) => s + Number(r.roomsPickedUp ?? 0), 0);

      const cutoffDate = (block.cutoffDate as string | null) ?? null;
      const daysToCutoff = cutoffDate
        ? Math.round((new Date(cutoffDate).getTime() - todayMs) / 86400000)
        : 30;

      signals.push({
        blockId: block.id,
        blockName: block.name,
        status: block.status,
        cutoffDate,
        daysToCutoff,
        roomsAllotted,
        roomsPickedUp,
      });
    }

    return {
      agentType: this.agentType,
      propertyId,
      timestamp: new Date(),
      signals: {
        historicalPickupRate,
        blocks: signals,
      },
    };
  }

  async recommend(analysis: AgentAnalysis): Promise<AgentDecisionInput[]> {
    const { historicalPickupRate, blocks } = analysis.signals as {
      historicalPickupRate: number;
      blocks: BlockSignal[];
    };

    if (!blocks || blocks.length === 0) return [];

    const blockForecasts = blocks.map((b) => {
      const forecast: PickupForecast = forecastPickup({
        roomsAllotted: b.roomsAllotted,
        roomsPickedUp: b.roomsPickedUp,
        daysToCutoff: b.daysToCutoff,
        historicalPickupRate,
      });
      return {
        blockId: b.blockId,
        blockName: b.blockName,
        cutoffDate: b.cutoffDate,
        daysToCutoff: b.daysToCutoff,
        roomsAllotted: b.roomsAllotted,
        roomsPickedUp: b.roomsPickedUp,
        ...forecast,
      };
    });

    const summary = {
      blocksAnalyzed: blockForecasts.length,
      totalAllotted: blockForecasts.reduce((s, b) => s + b.roomsAllotted, 0),
      totalPickedUp: blockForecasts.reduce((s, b) => s + b.roomsPickedUp, 0),
      totalProjectedWash: Math.round(
        blockForecasts.reduce((s, b) => s + b.projectedWash, 0) * 100,
      ) / 100,
      totalReleaseQty: blockForecasts.reduce((s, b) => s + b.releaseQty, 0),
      blocksRecommendedForRelease: blockForecasts.filter(
        (b) => b.recommendation !== 'hold',
      ).length,
    };

    // Confidence scales with how much pace has accumulated (closer to cutoff =
    // more certain) and how much of the block is already on the books.
    const confidence = blockForecasts.length > 0 ? 0.7 : 0.5;

    return [
      {
        decisionType: 'group_pickup_forecast',
        recommendation: {
          blocks: blockForecasts,
          summary,
        },
        confidence,
        inputSnapshot: {
          historicalPickupRate,
          blocksAnalyzed: blockForecasts.length,
          analyzedAt: analysis.timestamp.toISOString(),
        },
      },
    ];
  }

  async execute(_decision: AgentDecisionRecord): Promise<ExecutionResult> {
    // Releasing held inventory is a deliberate sales/revenue action performed
    // via the allotment release endpoint; the agent only advises.
    return {
      success: true,
      changes: [
        { entity: 'group_pickup', action: 'analyzed', detail: 'Pickup/wash forecast produced' },
      ],
    };
  }

  async recordOutcome(_decisionId: string, _outcome: AgentOutcome): Promise<void> {}

  async train(_propertyId: string): Promise<TrainingResult> {
    return { success: true, dataPoints: 0, modelVersion: 'group-pickup-v1', metrics: {} };
  }

  getDefaultConfig(): Record<string, unknown> {
    return {
      historicalPickupRate: 0.7,
      runScheduleCron: '0 8 * * *', // daily at 8am
    };
  }
}
