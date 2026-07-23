import { Injectable, Inject } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { depositLedgerEntries, folios } from '@telivityhaip/database';
import { DRIZZLE } from '../../database/database.module';
import { DepositService } from './deposit.service';
import { FolioService } from '../folio/folio.service';
import type { CancellationEvaluation, DepositAction } from '../policy/policy.service';

export interface SettlementResult {
  penaltyPosted: boolean;
  penaltyAmount: string;
  deposits: Array<{ id: string; status: string; amount: string }>;
  policyDescription: string;
  withinFreeWindow: boolean;
}

/**
 * Shared cancel / no-show deposit settlement (KB §10.4) plus optional penalty posting.
 */
@Injectable()
export class DepositSettlementService {
  constructor(
    @Inject(DRIZZLE) private readonly db: any,
    private readonly depositService: DepositService,
    private readonly folioService: FolioService,
  ) {}

  async listHeldDeposits(reservationId: string, propertyId: string) {
    return this.db
      .select()
      .from(depositLedgerEntries)
      .where(
        and(
          eq(depositLedgerEntries.reservationId, reservationId),
          eq(depositLedgerEntries.propertyId, propertyId),
          eq(depositLedgerEntries.status, 'held'),
        ),
      );
  }

  /**
   * Apply all held deposits to the guest folio (KB §10.3 — check-in recognition).
   */
  async applyHeldDeposits(reservationId: string, propertyId: string, folioId: string) {
    const held = await this.listHeldDeposits(reservationId, propertyId);
    const applied: Array<{ id: string; amount: string }> = [];
    for (const entry of held) {
      const updated = await this.depositService.applyDeposit(entry.id, {
        propertyId,
        folioId,
      });
      applied.push({ id: updated.id, amount: updated.amount });
    }
    return applied;
  }

  /**
   * Settle deposits + post cancel/no-show penalty from a policy evaluation.
   */
  async settleFromEvaluation(params: {
    reservationId: string;
    propertyId: string;
    currencyCode: string;
    evaluation: CancellationEvaluation;
    /** When set, posts this fee description (e.g. Cancellation penalty / No-show fee). */
    penaltyDescription?: string;
    /** Extra additive fee (property noShowFeeAmount) on top of policy penalty. */
    additionalFeeAmount?: number | string | null;
    additionalFeeDescription?: string;
  }): Promise<SettlementResult> {
    const {
      reservationId,
      propertyId,
      currencyCode,
      evaluation,
      penaltyDescription = 'Cancellation penalty',
      additionalFeeAmount,
      additionalFeeDescription = 'No-show fee',
    } = params;

    const deposits = await this.settleDeposits(
      reservationId,
      propertyId,
      evaluation.depositAction,
    );

    let penaltyPosted = false;
    const penaltyAmount = evaluation.penaltyAmount;

    const needsFolio =
      Number(evaluation.penaltyAmount) > 0 ||
      (additionalFeeAmount != null && Number(additionalFeeAmount) > 0);

    if (needsFolio) {
      const folio = await this.ensureGuestFolio(reservationId, propertyId);
      if (Number(evaluation.penaltyAmount) > 0) {
        await this.folioService.postCharge(folio.id, {
          propertyId,
          type: 'fee',
          description: penaltyDescription,
          amount: evaluation.penaltyAmount,
          currencyCode,
          serviceDate: new Date().toISOString(),
        });
        penaltyPosted = true;
      }
      if (additionalFeeAmount != null && Number(additionalFeeAmount) > 0) {
        await this.folioService.postCharge(folio.id, {
          propertyId,
          type: 'fee',
          description: additionalFeeDescription,
          amount: String(Number(additionalFeeAmount).toFixed(2)),
          currencyCode,
          serviceDate: new Date().toISOString(),
        });
      }
    }

    return {
      penaltyPosted,
      penaltyAmount,
      deposits,
      policyDescription: evaluation.policyDescription,
      withinFreeWindow: evaluation.withinFreeWindow,
    };
  }

  async settleDeposits(
    reservationId: string,
    propertyId: string,
    depositAction: DepositAction,
  ) {
    const held = await this.listHeldDeposits(reservationId, propertyId);
    const results: Array<{ id: string; status: string; amount: string }> = [];

    for (const entry of held) {
      let updated;
      if (depositAction === 'refund') {
        if (entry.isRefundable) {
          updated = await this.depositService.refundDeposit(entry.id, propertyId);
        } else {
          // Non-refundable deposits cannot take the refund path — forfeit instead.
          updated = await this.depositService.forfeitDeposit(entry.id, propertyId);
        }
      } else {
        updated = await this.depositService.forfeitDeposit(entry.id, propertyId);
      }
      results.push({ id: updated.id, status: updated.status, amount: updated.amount });
    }

    return results;
  }

  private async ensureGuestFolio(reservationId: string, propertyId: string) {
    const [existing] = await this.db
      .select()
      .from(folios)
      .where(
        and(
          eq(folios.reservationId, reservationId),
          eq(folios.propertyId, propertyId),
          eq(folios.type, 'guest' as any),
        ),
      );
    if (existing) return existing;

    // createAutoFolio needs a reservation-like object; load minimal fields via deposit reservation join path
    const { reservations } = await import('@telivityhaip/database');
    const [reservation] = await this.db
      .select()
      .from(reservations)
      .where(and(eq(reservations.id, reservationId), eq(reservations.propertyId, propertyId)));
    return this.folioService.createAutoFolio(reservation);
  }
}
