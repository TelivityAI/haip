import { Injectable, Inject, OnModuleInit } from '@nestjs/common';
import { eq, and, gte, not, inArray } from 'drizzle-orm';
import { reservations, guests, folios, payments, bookings, depositLedgerEntries } from '@telivityhaip/database';
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
  heuristicCancelProbability,
  calibrateSourceRates,
  classifyRisk,
  aggregateByDate,
  depositForfeitRisk,
  type ReservationRiskScore,
} from './cancellation-predictor.models';

@Injectable()
export class CancellationPredictorAgent implements HaipAgent, OnModuleInit {
  readonly agentType = 'cancellation';

  constructor(
    @Inject(DRIZZLE) private readonly db: any,
    private readonly agentService: AgentService,
  ) {}

  onModuleInit() {
    this.agentService.registerAgent(this);
  }

  async analyze(propertyId: string, _context?: AgentContext): Promise<AgentAnalysis> {
    const today = new Date().toISOString().split('T')[0]!;

    // Per-property learned cancel rates (from train()); falls back to the cold-start
    // prior inside heuristicCancelProbability when the agent hasn't trained yet.
    const config = await this.agentService.getOrCreateConfig(propertyId, this.agentType);
    const learnedRates = (config?.modelState as any)?.learned as Record<string, number> | undefined;

    // Get active reservations (confirmed, pending) joined with their booking so we can
    // see the real booking source. `source` lives on `bookings`, not on `reservations`.
    const activeResRaw = await this.db
      .select({
        reservation: reservations,
        bookingSource: bookings.source,
        bookingChannelCode: bookings.channelCode,
      })
      .from(reservations)
      .leftJoin(bookings, eq(reservations.bookingId, bookings.id))
      .where(
        and(
          eq(reservations.propertyId, propertyId),
          gte(reservations.arrivalDate, today),
          not(inArray(reservations.status, ['cancelled', 'checked_out', 'no_show'] as any)),
        ),
      );

    const activeRes = activeResRaw.map((row: any) => ({
      ...row.reservation,
      source: row.bookingSource ?? null,
      channelCode: row.bookingChannelCode ?? null,
    }));

    // Get guest data for VIP/repeat detection
    const guestIds = [...new Set(activeRes.map((r: any) => r.guestId).filter(Boolean))];
    let guestMap = new Map<string, any>();
    if (guestIds.length > 0) {
      const guestData = await this.db.select().from(guests);
      guestMap = new Map(guestData.map((g: any) => [g.id, g]));
    }

    // Check for deposits/payments (via folio → payment chain)
    const paymentMap = new Map<string, boolean>();
    const folioData = await this.db
      .select({ id: folios.id, reservationId: folios.reservationId })
      .from(folios)
      .where(eq(folios.propertyId, propertyId));
    const folioToRes = new Map<string, string>();
    for (const f of folioData) {
      if (f.reservationId) folioToRes.set(f.id, f.reservationId);
    }
    const paymentData = await this.db
      .select({ folioId: payments.folioId, status: payments.status })
      .from(payments)
      .where(eq(payments.propertyId, propertyId));
    for (const p of paymentData) {
      if (['captured', 'settled', 'authorized'].includes(p.status)) {
        const resId = folioToRes.get(p.folioId);
        if (resId) paymentMap.set(resId, true);
      }
    }

    // Count past stays per guest (repeat guest detection)
    const repeatCounts = new Map<string, number>();
    const historicalRes = await this.db
      .select({ guestId: reservations.guestId, status: reservations.status })
      .from(reservations)
      .where(eq(reservations.propertyId, propertyId));
    for (const r of historicalRes) {
      if (r.guestId && r.status === 'checked_out') {
        repeatCounts.set(r.guestId, (repeatCounts.get(r.guestId) ?? 0) + 1);
      }
    }

    // Held deposits (liability, not yet recognized — KB 10.2). Map reservationId → deposit info
    // so we can estimate forfeit/refund exposure per at-risk reservation (KB 10.4).
    const depositMap = new Map<string, { isRefundable: boolean; amount: number }>();
    const heldDeposits = await this.db
      .select({
        reservationId: depositLedgerEntries.reservationId,
        isRefundable: depositLedgerEntries.isRefundable,
        amount: depositLedgerEntries.amount,
      })
      .from(depositLedgerEntries)
      .where(
        and(
          eq(depositLedgerEntries.propertyId, propertyId),
          eq(depositLedgerEntries.status, 'held' as any),
        ),
      );
    for (const d of heldDeposits) {
      if (!d.reservationId) continue;
      const existing = depositMap.get(d.reservationId);
      const amount = parseFloat(d.amount ?? '0');
      // Aggregate multiple held deposits on one reservation; refundable if any are refundable.
      depositMap.set(d.reservationId, {
        isRefundable: (existing?.isRefundable ?? false) || Boolean(d.isRefundable),
        amount: (existing?.amount ?? 0) + amount,
      });
    }

    return {
      agentType: this.agentType,
      propertyId,
      timestamp: new Date(),
      signals: {
        activeReservations: activeRes,
        guestMap: Object.fromEntries(guestMap),
        paymentMap: Object.fromEntries(paymentMap),
        repeatCounts: Object.fromEntries(repeatCounts),
        depositMap: Object.fromEntries(depositMap),
        today,
        learnedRates,
      },
    };
  }

  async recommend(analysis: AgentAnalysis): Promise<AgentDecisionInput[]> {
    const { activeReservations, guestMap, paymentMap, repeatCounts, depositMap, today, learnedRates } =
      analysis.signals as any;

    if (activeReservations.length === 0) return [];

    const scores: ReservationRiskScore[] = [];
    const arrivalDates = new Map<string, string>();

    for (const res of activeReservations) {
      const guest = guestMap[res.guestId] ?? {};
      const hasDeposit = paymentMap[res.id] ?? false;
      const pastStays = repeatCounts[res.guestId] ?? 0;
      const isRepeatGuest = pastStays > 0;
      const isVip = guest.vipLevel && guest.vipLevel !== 'none';

      const bookingDate = res.createdAt ? new Date(res.createdAt) : new Date();
      const arrivalDate = new Date(res.arrivalDate);
      const leadTimeDays = Math.max(0, Math.ceil((arrivalDate.getTime() - bookingDate.getTime()) / 86400000));
      const daysUntilArrival = Math.max(0, Math.ceil((arrivalDate.getTime() - new Date(today).getTime()) / 86400000));

      const { probability, factors } = heuristicCancelProbability({
        bookingSource: res.source ?? 'direct',
        hasDeposit,
        isRepeatGuest,
        isVip,
        leadTimeDays,
        daysUntilArrival,
        rates: learnedRates,
      });

      const totalAmount = parseFloat(res.totalAmount ?? '0');

      const score: ReservationRiskScore & { depositRisk?: ReturnType<typeof depositForfeitRisk> } = {
        reservationId: res.id,
        cancellationProbability: probability,
        riskLevel: classifyRisk(probability),
        riskFactors: factors,
        daysUntilArrival,
        revenueAtRisk: Math.round(totalAmount * probability),
      };

      // Attach deposit forfeit/refund exposure when this reservation has a held deposit (KB 10.4).
      const heldDeposit = depositMap?.[res.id];
      if (heldDeposit) {
        score.depositRisk = depositForfeitRisk({
          cancellationProbability: probability,
          isRefundable: Boolean(heldDeposit.isRefundable),
          depositAmount: Number(heldDeposit.amount ?? 0),
        });
      }

      scores.push(score);

      arrivalDates.set(res.id, res.arrivalDate);
    }

    const dateAggregates = aggregateByDate(scores, arrivalDates);

    const highRisk = scores.filter((s) => s.riskLevel === 'high');
    const totalRevenueAtRisk = scores.reduce((s, r) => s + r.revenueAtRisk, 0);
    const avgConfidence = 0.65; // heuristic model base confidence

    return [
      {
        decisionType: 'cancellation_prediction',
        recommendation: {
          scores: scores.sort((a, b) => b.cancellationProbability - a.cancellationProbability),
          dateAggregates,
          summary: {
            totalReservations: scores.length,
            highRiskCount: highRisk.length,
            mediumRiskCount: scores.filter((s) => s.riskLevel === 'medium').length,
            lowRiskCount: scores.filter((s) => s.riskLevel === 'low').length,
            totalRevenueAtRisk,
            expectedCancellations: Math.round(scores.reduce((s, r) => s + r.cancellationProbability, 0) * 10) / 10,
          },
        },
        confidence: avgConfidence,
        inputSnapshot: {
          reservationCount: activeReservations.length,
          analyzedAt: analysis.timestamp.toISOString(),
        },
      },
    ];
  }

  async execute(_decision: AgentDecisionRecord): Promise<ExecutionResult> {
    return {
      success: true,
      changes: [{ entity: 'cancellation_prediction', action: 'published', detail: 'Risk scores updated' }],
    };
  }

  async recordOutcome(_decisionId: string, _outcome: AgentOutcome): Promise<void> {}

  /**
   * Learn this property's per-source cancellation rates from its own booking
   * history (last ~365 days), smoothed toward the default prior. AgentService
   * persists the returned `metrics` into `agent_configs.modelState.learned`,
   * which `analyze()` then uses instead of the cold-start defaults.
   */
  async train(propertyId: string): Promise<TrainingResult> {
    const since = new Date(Date.now() - 365 * 86_400_000).toISOString().split('T')[0]!;
    const rows = await this.db
      .select({ status: reservations.status, source: bookings.source })
      .from(reservations)
      .leftJoin(bookings, eq(reservations.bookingId, bookings.id))
      .where(and(eq(reservations.propertyId, propertyId), gte(reservations.arrivalDate, since)));

    const history = rows.map((r: any) => ({
      source: r.source ?? null,
      cancelled: r.status === 'cancelled' || r.status === 'no_show',
    }));
    const learned = calibrateSourceRates(history);

    return {
      success: true,
      dataPoints: history.length,
      modelVersion: 'cancellation-predictor-v2',
      // Stored by AgentService into modelState.learned and read back by analyze().
      metrics: learned,
    };
  }

  getDefaultConfig(): Record<string, unknown> {
    return {
      highRiskThreshold: 0.40,
      mediumRiskThreshold: 0.15,
      runScheduleCron: '0 */6 * * *', // every 6 hours
    };
  }
}
