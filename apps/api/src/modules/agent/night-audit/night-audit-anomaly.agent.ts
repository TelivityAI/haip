import { Injectable, Inject, OnModuleInit } from '@nestjs/common';
import { eq, and, gte, lte, not, inArray } from 'drizzle-orm';
import { reservations, folios, charges as chargesTable, guests, cashDrawerSessions } from '@telivityhaip/database';
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
  type Anomaly,
  getSeverity,
  rankAnomalies,
  buildChargeProfiles,
  isStatisticalOutlier,
  isCashVarianceAnomaly,
} from './night-audit-anomaly.models';

@Injectable()
export class NightAuditAnomalyAgent implements HaipAgent, OnModuleInit {
  readonly agentType = 'night_audit';

  constructor(
    @Inject(DRIZZLE) private readonly db: any,
    private readonly agentService: AgentService,
  ) {}

  onModuleInit() {
    this.agentService.registerAgent(this);
  }

  async analyze(propertyId: string, _context?: AgentContext): Promise<AgentAnalysis> {
    const today = new Date().toISOString().split('T')[0]!;

    // Get in-house + recently checked-out reservations (should have charges posted).
    // Include checked_out so payment-mismatch detection has a reachable trigger —
    // previously the mismatch rule required status === 'checked_out' but the query
    // only selected in-house statuses, making the rule dead code.
    const checkedIn = await this.db
      .select()
      .from(reservations)
      .where(
        and(
          eq(reservations.propertyId, propertyId),
          inArray(reservations.status, ['checked_in', 'stayover', 'due_out', 'checked_out'] as any),
        ),
      );

    // Get today's confirmed reservations (no-show candidates)
    const confirmed = await this.db
      .select()
      .from(reservations)
      .where(
        and(
          eq(reservations.propertyId, propertyId),
          eq(reservations.status, 'confirmed' as any),
          lte(reservations.arrivalDate, today),
        ),
      );

    // Get open folios
    const openFolios = await this.db
      .select()
      .from(folios)
      .where(
        and(
          eq(folios.propertyId, propertyId),
          eq(folios.status, 'open' as any),
        ),
      );

    // Get all charges for open folios
    const folioIds = openFolios.map((f: any) => f.id);
    let folioChargeRows: any[] = [];
    if (folioIds.length > 0) {
      folioChargeRows = await this.db
        .select()
        .from(chargesTable)
        .where(inArray(chargesTable.folioId, folioIds));
    }

    // Get historical charges for statistical profiles (if enough data)
    const historicalCharges = await this.db
      .select({ type: chargesTable.type, amount: chargesTable.amount })
      .from(chargesTable)
      .innerJoin(folios, eq(folios.id, chargesTable.folioId))
      .where(eq(folios.propertyId, propertyId));

    const chargeProfiles = buildChargeProfiles(
      historicalCharges.map((c: any) => ({ type: c.type, amount: parseFloat(c.amount ?? '0') })),
    );

    // Closed cash drawer sessions for this property — checked for variance outliers (KB 12.4).
    const closedSessionsRaw = await this.db
      .select({ id: cashDrawerSessions.id, variance: cashDrawerSessions.variance })
      .from(cashDrawerSessions)
      .where(
        and(
          eq(cashDrawerSessions.propertyId, propertyId),
          eq(cashDrawerSessions.status, 'closed' as any),
        ),
      );
    const closedSessions = closedSessionsRaw.map((s: any) => ({
      id: s.id,
      variance: Number(s.variance ?? 0),
    }));

    return {
      agentType: this.agentType,
      propertyId,
      timestamp: new Date(),
      signals: {
        checkedIn,
        confirmed,
        openFolios,
        charges: folioChargeRows,
        chargeProfiles: Object.fromEntries(chargeProfiles),
        closedSessions,
        today,
      },
    };
  }

  async recommend(analysis: AgentAnalysis): Promise<AgentDecisionInput[]> {
    const { checkedIn, confirmed, openFolios, charges, chargeProfiles, closedSessions, today } =
      analysis.signals as any;

    const anomalies: Anomaly[] = [];
    const profiles = new Map<string, any>(Object.entries(chargeProfiles));

    // Build lookup maps
    const foliosByReservation = new Map<string, any[]>();
    for (const f of openFolios) {
      const arr = foliosByReservation.get(f.reservationId) ?? [];
      arr.push(f);
      foliosByReservation.set(f.reservationId, arr);
    }

    const chargesByFolio = new Map<string, any[]>();
    for (const c of charges) {
      const arr = chargesByFolio.get(c.folioId) ?? [];
      arr.push(c);
      chargesByFolio.set(c.folioId, arr);
    }

    for (const res of checkedIn) {
      const resFolios = foliosByReservation.get(res.id) ?? [];

      // 1. Unposted charges — checked in with no charges
      if (resFolios.length === 0) {
        anomalies.push({
          anomalyType: 'unposted_charges',
          severity: getSeverity('unposted_charges'),
          affectedEntity: { type: 'reservation', id: res.id },
          description: `Room ${res.roomId} is checked in but has no folio or charges posted`,
          suggestedAction: 'Post room charges for this stay',
          confidence: 0.9,
        });
      } else {
        for (const folio of resFolios) {
          const fCharges = chargesByFolio.get(folio.id) ?? [];
          const roomCharges = fCharges.filter((c: any) => c.type === 'room');
          const taxCharges = fCharges.filter((c: any) => c.type === 'tax');

          // No room charges posted
          if (roomCharges.length === 0) {
            anomalies.push({
              anomalyType: 'unposted_charges',
              severity: getSeverity('unposted_charges'),
              affectedEntity: { type: 'folio', id: folio.id },
              description: `Folio ${folio.folioNumber} has no room charges posted`,
              suggestedAction: 'Post room tariff for the current stay',
              confidence: 0.85,
            });
          }

          // 8. Missing tax — room charges without corresponding tax
          if (roomCharges.length > 0 && taxCharges.length === 0) {
            anomalies.push({
              anomalyType: 'missing_tax',
              severity: getSeverity('missing_tax'),
              affectedEntity: { type: 'folio', id: folio.id },
              description: `Folio ${folio.folioNumber} has room charges but no tax posted`,
              suggestedAction: 'Apply tax rules to room charges',
              confidence: 0.95,
            });
          }

          // 9. Payment mismatch
          const totalChargesAmt = parseFloat(folio.totalCharges ?? '0');
          const totalPaymentsAmt = parseFloat(folio.totalPayments ?? '0');
          const balance = Math.abs(totalChargesAmt - totalPaymentsAmt);
          // Payment mismatch is an anomaly when the stay has ended (due_out / checked_out)
          // but the folio is still open with a non-zero balance.
          const mismatchStatuses = ['due_out', 'checked_out'];
          if (totalChargesAmt > 0 && balance > 0.01 && mismatchStatuses.includes(res.status)) {
            anomalies.push({
              anomalyType: 'payment_mismatch',
              severity: getSeverity('payment_mismatch'),
              affectedEntity: { type: 'folio', id: folio.id },
              description: `Folio balance mismatch: charges $${totalChargesAmt.toFixed(2)} vs payments $${totalPaymentsAmt.toFixed(2)}`,
              suggestedAction: 'Reconcile charges and payments',
              confidence: 0.95,
            });
          }

          // 7. Unusual charges (statistical)
          for (const charge of fCharges) {
            const profile = profiles.get(charge.type);
            if (profile && isStatisticalOutlier(parseFloat(charge.amount ?? '0'), profile)) {
              anomalies.push({
                anomalyType: 'unusual_charge',
                severity: getSeverity('unusual_charge'),
                affectedEntity: { type: 'folio', id: folio.id },
                description: `${charge.type} charge of $${charge.amount} is unusually high (avg: $${profile.mean.toFixed(2)})`,
                suggestedAction: 'Verify this charge is correct',
                confidence: 0.7,
              });
            }
          }
        }
      }

      // 5. Stale checked-in — past departure date
      if (res.departureDate && res.departureDate < today && ['checked_in', 'stayover'].includes(res.status)) {
        anomalies.push({
          anomalyType: 'stale_checked_in',
          severity: getSeverity('stale_checked_in'),
          affectedEntity: { type: 'reservation', id: res.id },
          description: `Reservation departed ${res.departureDate} but still shows ${res.status}`,
          suggestedAction: 'Check out or extend this reservation',
          confidence: 0.95,
        });
      }

      // 6. Duplicate folios
      if (resFolios.length > 1) {
        anomalies.push({
          anomalyType: 'duplicate_folio',
          severity: getSeverity('duplicate_folio'),
          affectedEntity: { type: 'reservation', id: res.id },
          description: `Reservation has ${resFolios.length} open folios — possible duplicate`,
          suggestedAction: 'Review and merge or close duplicate folios',
          confidence: 0.6,
        });
      }
    }

    // 10. No-show candidates
    for (const res of confirmed) {
      anomalies.push({
        anomalyType: 'no_show_candidate',
        severity: getSeverity('no_show_candidate'),
        affectedEntity: { type: 'reservation', id: res.id },
        description: `Reservation for ${res.arrivalDate} is still confirmed — guest may be a no-show`,
        suggestedAction: 'Contact guest or mark as no-show',
        confidence: 0.75,
      });
    }

    // Cash drawer variance outliers — closed sessions with material variance (KB 12.4)
    for (const session of closedSessions ?? []) {
      const variance = Number(session.variance ?? 0);
      if (isCashVarianceAnomaly(variance)) {
        anomalies.push({
          anomalyType: 'cash_variance_outlier',
          severity: getSeverity('cash_variance_outlier'),
          affectedEntity: { type: 'cash_session', id: session.id },
          description: `Cash drawer session closed with variance $${variance.toFixed(2)}`,
          suggestedAction: 'Review cashier shift and recount drawer',
          confidence: 0.9,
        });
      }
    }

    if (anomalies.length === 0) return [];

    const ranked = rankAnomalies(anomalies);
    const avgConfidence = ranked.reduce((s, a) => s + a.confidence, 0) / ranked.length;

    return [
      {
        decisionType: 'night_audit_anomaly',
        recommendation: {
          anomalies: ranked,
          summary: {
            total: ranked.length,
            critical: ranked.filter((a) => a.severity === 'critical').length,
            warning: ranked.filter((a) => a.severity === 'warning').length,
            info: ranked.filter((a) => a.severity === 'info').length,
          },
        },
        confidence: avgConfidence,
        inputSnapshot: {
          checkedInCount: checkedIn.length,
          confirmedCount: confirmed.length,
          folioCount: openFolios.length,
          analyzedAt: analysis.timestamp.toISOString(),
        },
      },
    ];
  }

  async execute(_decision: AgentDecisionRecord): Promise<ExecutionResult> {
    return {
      success: true,
      changes: [{ entity: 'night_audit', action: 'analyzed', detail: 'Anomaly report generated' }],
    };
  }

  async recordOutcome(_decisionId: string, _outcome: AgentOutcome): Promise<void> {}

  async train(_propertyId: string): Promise<TrainingResult> {
    return { success: true, dataPoints: 0, modelVersion: 'night-audit-anomaly-v1', metrics: {} };
  }

  getDefaultConfig(): Record<string, unknown> {
    return {
      outlierThreshold: 2.5,
      paymentMismatchThreshold: 1.00,
      runScheduleCron: '0 23 * * *', // daily at 11pm (before night audit)
    };
  }
}
