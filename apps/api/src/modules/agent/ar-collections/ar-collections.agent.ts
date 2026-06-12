import { Injectable, Inject, OnModuleInit } from '@nestjs/common';
import { eq, and, inArray } from 'drizzle-orm';
import { arLedgers, arTransactions } from '@telivityhaip/database';
import Decimal from 'decimal.js';
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
  scoreArLedger,
  rankCollections,
  type ArAgingInput,
  type ArCollectionScore,
} from './ar-collections.models';

@Injectable()
export class ArCollectionsAgent implements HaipAgent, OnModuleInit {
  readonly agentType = 'ar_collections';

  constructor(
    @Inject(DRIZZLE) private readonly db: any,
    private readonly agentService: AgentService,
  ) {}

  onModuleInit() {
    this.agentService.registerAgent(this);
  }

  async analyze(propertyId: string, _context?: AgentContext): Promise<AgentAnalysis> {
    await this.agentService.getOrCreateConfig(propertyId, this.agentType);

    // Open A/R ledgers for this property (KB 11.2).
    const openLedgers = await this.db
      .select()
      .from(arLedgers)
      .where(
        and(
          eq(arLedgers.propertyId, propertyId),
          eq(arLedgers.status, 'open' as any),
        ),
      );

    const now = Date.now();
    const ledgerInputs: ArAgingInput[] = [];

    if (openLedgers.length > 0) {
      const ledgerIds = openLedgers.map((l: any) => l.id);

      // All transfer_in transactions for these ledgers that have NOT been reversed.
      const transfers = await this.db
        .select()
        .from(arTransactions)
        .where(
          and(
            eq(arTransactions.propertyId, propertyId),
            inArray(arTransactions.arLedgerId, ledgerIds),
            eq(arTransactions.type, 'transfer_in' as any),
          ),
        );

      // Group open (non-reversed) transfers per ledger.
      const byLedger = new Map<string, any[]>();
      for (const t of transfers) {
        if (t.reversedById) continue; // reversed transfer — excluded (KB 11.4)
        const arr = byLedger.get(t.arLedgerId) ?? [];
        arr.push(t);
        byLedger.set(t.arLedgerId, arr);
      }

      for (const ledger of openLedgers) {
        const open = byLedger.get(ledger.id) ?? [];
        const openTransferCount = open.length;

        let oldestTransferAgeDays = 0;
        if (open.length > 0) {
          const oldest = open.reduce((min: number, t: any) => {
            const ts = t.createdAt ? new Date(t.createdAt).getTime() : now;
            return Math.min(min, ts);
          }, now);
          oldestTransferAgeDays = Math.max(0, Math.floor((now - oldest) / 86400000));
        }

        // paymentTermsDays is stored as "NET30"/"NET60" text; extract the integer.
        const termsMatch = /(\d+)/.exec(ledger.paymentTermsDays ?? '');
        const paymentTermsDays = termsMatch ? parseInt(termsMatch[1]!, 10) : null;

        ledgerInputs.push({
          arLedgerId: ledger.id,
          ledgerName: ledger.name,
          balance: new Decimal(ledger.balance ?? '0').toNumber(),
          oldestTransferAgeDays,
          openTransferCount,
          paymentTermsDays,
        });
      }
    }

    return {
      agentType: this.agentType,
      propertyId,
      timestamp: new Date(),
      signals: {
        ledgers: ledgerInputs,
      },
    };
  }

  async recommend(analysis: AgentAnalysis): Promise<AgentDecisionInput[]> {
    const { ledgers } = analysis.signals as { ledgers: ArAgingInput[] };

    // Only consider ledgers that actually owe money.
    const billable = ledgers.filter((l) => l.balance > 0);
    if (billable.length === 0) return [];

    const scores: ArCollectionScore[] = billable.map((l) => scoreArLedger(l));
    const rankings = rankCollections(scores);

    const highRiskCount = rankings.filter((r) => r.riskLevel === 'high').length;
    const totalOutstanding =
      Math.round(billable.reduce((s, l) => s + l.balance, 0) * 100) / 100;

    return [
      {
        decisionType: 'ar_collections_priority',
        recommendation: {
          rankings,
          summary: {
            ledgersAnalyzed: rankings.length,
            highRiskCount,
            totalOutstanding,
          },
        },
        confidence: 0.8,
        inputSnapshot: {
          openLedgerCount: ledgers.length,
          billableLedgerCount: billable.length,
          analyzedAt: analysis.timestamp.toISOString(),
        },
      },
    ];
  }

  async execute(_decision: AgentDecisionRecord): Promise<ExecutionResult> {
    // Advisory only — surfaces a prioritized worklist; no ledger mutation.
    return {
      success: true,
      changes: [{ entity: 'ar_ledger', action: 'flagged', detail: 'Collection priorities published' }],
    };
  }

  async recordOutcome(_decisionId: string, _outcome: AgentOutcome): Promise<void> {}

  async train(_propertyId: string): Promise<TrainingResult> {
    return { success: true, dataPoints: 0, modelVersion: 'ar-collections-v1', metrics: {} };
  }

  getDefaultConfig(): Record<string, unknown> {
    return {
      highRiskThreshold: 0.66,
      mediumRiskThreshold: 0.33,
      defaultPaymentTermsDays: 30,
      runScheduleCron: '0 6 * * *', // daily at 6am
    };
  }
}
