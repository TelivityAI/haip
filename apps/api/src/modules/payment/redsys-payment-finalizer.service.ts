import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import {
  bookingEngineConfig,
  depositLedgerEntries,
  folios,
  payments,
  reservations,
} from '@telivityhaip/database';
import { DRIZZLE } from '../../database/database.module';
import { WebhookService } from '../webhook/webhook.service';
import { DepositService } from '../accounting/deposit.service';
import { ReservationService } from '../reservation/reservation.service';

type PaymentRow = typeof payments.$inferSelect;

/**
 * Idempotent post-authorization finalizer for Redsys MerchantURL notifications.
 *
 * Browser URLOK/URLKO is navigation only. Signature-verified provider results
 * own payment state, deposit ledger creation, and booking-engine auto-confirm.
 */
@Injectable()
export class RedsysPaymentFinalizer {
  private readonly logger = new Logger(RedsysPaymentFinalizer.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: any,
    private readonly webhookService: WebhookService,
    private readonly depositService: DepositService,
    @Inject(forwardRef(() => ReservationService))
    private readonly reservationService: ReservationService,
  ) {}

  async finalizeVerifiedNotification(input: {
    payment: PaymentRow;
    success: boolean;
    dsResponse?: string;
  }): Promise<void> {
    const { payment, success, dsResponse } = input;

    if (!success) {
      await this.markFailed(payment, dsResponse);
      return;
    }

    const authorized = await this.markAuthorized(payment, dsResponse);
    const current = authorized ?? payment;
    if (current.status !== 'authorized' && current.status !== 'captured') {
      // Lost the pending→authorized race to another writer with a non-success path.
      return;
    }

    await this.ensureDepositAndConfirm(current);
  }

  private async markAuthorized(
    payment: PaymentRow,
    dsResponse?: string,
  ): Promise<PaymentRow | null> {
    if (payment.status === 'authorized' || payment.status === 'captured') {
      return payment;
    }

    const [updated] = await this.db
      .update(payments)
      .set({
        status: 'authorized',
        notes: payment.notes
          ? `${payment.notes}; redsys Ds_Response=${dsResponse}`
          : `redsys Ds_Response=${dsResponse}`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(payments.id, payment.id),
          eq(payments.propertyId, payment.propertyId),
          eq(payments.status, 'pending'),
        ),
      )
      .returning();

    if (updated) {
      await this.webhookService.emit(
        'payment.received',
        'payment',
        updated.id,
        {
          folioId: updated.folioId,
          status: 'authorized',
          amount: updated.amount,
          gatewayProvider: 'redsys',
        },
        updated.propertyId,
      );
      this.logger.log(
        `Redsys payment=${updated.id} authorized order=${updated.gatewayTransactionId}`,
      );
      return updated;
    }

    const [fresh] = await this.db
      .select()
      .from(payments)
      .where(
        and(
          eq(payments.id, payment.id),
          eq(payments.propertyId, payment.propertyId),
        ),
      )
      .limit(1);
    return fresh ?? null;
  }

  private async markFailed(payment: PaymentRow, dsResponse?: string): Promise<void> {
    if (payment.status !== 'pending') {
      return;
    }

    const [updated] = await this.db
      .update(payments)
      .set({
        status: 'failed',
        notes: `redsys Ds_Response=${dsResponse ?? 'unknown'}`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(payments.id, payment.id),
          eq(payments.propertyId, payment.propertyId),
          eq(payments.status, 'pending'),
        ),
      )
      .returning();

    if (!updated) {
      return;
    }

    await this.webhookService.emit(
      'payment.failed',
      'payment',
      payment.id,
      {
        folioId: payment.folioId,
        error: `Ds_Response=${dsResponse ?? 'unknown'}`,
      },
      payment.propertyId,
    );
    this.logger.warn(
      `Redsys payment=${payment.id} failed Ds_Response=${dsResponse}`,
    );
  }

  private async ensureDepositAndConfirm(payment: PaymentRow): Promise<void> {
    if (!payment.folioId) {
      this.logger.warn(
        `Redsys payment=${payment.id} has no folio — skipping deposit/confirm`,
      );
      return;
    }

    const [folio] = await this.db
      .select()
      .from(folios)
      .where(
        and(
          eq(folios.id, payment.folioId),
          eq(folios.propertyId, payment.propertyId),
        ),
      )
      .limit(1);

    if (!folio?.reservationId) {
      this.logger.warn(
        `Redsys payment=${payment.id} folio=${payment.folioId} has no reservation — skipping deposit/confirm`,
      );
      return;
    }

    const [existingDeposit] = await this.db
      .select({ id: depositLedgerEntries.id })
      .from(depositLedgerEntries)
      .where(
        and(
          eq(depositLedgerEntries.paymentId, payment.id),
          eq(depositLedgerEntries.propertyId, payment.propertyId),
        ),
      )
      .limit(1);

    if (!existingDeposit) {
      const [cfg] = await this.db
        .select()
        .from(bookingEngineConfig)
        .where(eq(bookingEngineConfig.propertyId, payment.propertyId))
        .limit(1);
      const refundable =
        (cfg?.depositPolicy as { refundable?: boolean } | null)?.refundable ??
        true;

      await this.depositService.recordDeposit({
        propertyId: payment.propertyId,
        reservationId: folio.reservationId,
        paymentId: payment.id,
        amount: String(payment.amount),
        currencyCode: payment.currencyCode,
        isRefundable: refundable,
      } as any);
    }

    const [cfg] = await this.db
      .select({ autoConfirm: bookingEngineConfig.autoConfirm })
      .from(bookingEngineConfig)
      .where(eq(bookingEngineConfig.propertyId, payment.propertyId))
      .limit(1);

    if (!cfg?.autoConfirm) {
      return;
    }

    const [reservation] = await this.db
      .select({ id: reservations.id, status: reservations.status })
      .from(reservations)
      .where(
        and(
          eq(reservations.id, folio.reservationId),
          eq(reservations.propertyId, payment.propertyId),
        ),
      )
      .limit(1);

    if (!reservation || reservation.status !== 'pending') {
      return;
    }

    try {
      await this.reservationService.confirm(reservation.id, payment.propertyId);
      this.logger.log(
        `Redsys auto-confirmed reservation=${reservation.id} payment=${payment.id}`,
      );
    } catch (err) {
      // Idempotent confirm may race; log and continue.
      this.logger.warn(
        `Redsys auto-confirm skipped for reservation=${reservation.id}: ${String(err)}`,
      );
    }
  }
}
