import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { eq, and, sql } from 'drizzle-orm';
import { Decimal } from 'decimal.js';
import { payments } from '@telivityhaip/database';
import { DRIZZLE } from '../../database/database.module';
import { WebhookService } from '../webhook/webhook.service';
import { FolioService } from '../folio/folio.service';
import { PAYMENT_GATEWAY } from './interfaces/payment-gateway.interface';
import type { PaymentGateway } from './interfaces/payment-gateway.interface';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { AuthorizePaymentDto } from './dto/authorize-payment.dto';
import { ListPaymentsDto } from './dto/list-payments.dto';
import { sumRefundChildren, parentCountsTowardFolioBalance } from './payment-ledger';

const CARD_METHODS = ['credit_card', 'debit_card', 'vcc'];

@Injectable()
export class PaymentService {
  constructor(
    @Inject(DRIZZLE) private readonly db: any,
    private readonly folioService: FolioService,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
    private readonly webhookService: WebhookService,
  ) {}

  async recordPayment(dto: CreatePaymentDto) {
    if (CARD_METHODS.includes(dto.method)) {
      throw new BadRequestException(
        `Card payments must use the authorize flow. Use POST /payments/authorize instead.`,
      );
    }

    const folio = await this.folioService.findById(dto.folioId, dto.propertyId);
    if (folio.status !== 'open') {
      throw new BadRequestException('Cannot record payment on a folio that is not open');
    }

    const [payment] = await this.db
      .insert(payments)
      .values({
        ...dto,
        status: 'captured',
        processedAt: new Date(),
      })
      .returning();

    await this.folioService.recalculateBalance(dto.folioId, dto.propertyId);

    await this.webhookService.emit(
      'payment.received',
      'payment',
      payment.id,
      { folioId: dto.folioId, method: payment.method, amount: payment.amount, status: 'captured' },
      dto.propertyId,
    );

    return payment;
  }

  async authorizePayment(dto: AuthorizePaymentDto) {
    const folio = await this.folioService.findById(dto.folioId, dto.propertyId);
    if (folio.status !== 'open') {
      throw new BadRequestException('Cannot authorize payment on a folio that is not open');
    }

    // Gateway expects a number; keep the canonical stored value as the string.
    // Decimal keeps precision through the conversion boundary.
    const result = await this.gateway.authorize(
      dto.gatewayPaymentToken,
      new Decimal(dto.amount).toNumber(),
      dto.currencyCode,
    );

    if (!result.success) {
      const [failed] = await this.db
        .insert(payments)
        .values({
          folioId: dto.folioId,
          propertyId: dto.propertyId,
          method: 'credit_card',
          amount: dto.amount,
          currencyCode: dto.currencyCode,
          status: 'failed',
          gatewayProvider: dto.gatewayProvider,
          gatewayPaymentToken: dto.gatewayPaymentToken,
          gatewayTransactionId: result.transactionId,
          cardLastFour: dto.cardLastFour,
          cardBrand: dto.cardBrand,
          notes: result.errorMessage,
        })
        .returning();

      await this.webhookService.emit(
        'payment.failed',
        'payment',
        failed.id,
        { folioId: dto.folioId, error: result.errorMessage },
        dto.propertyId,
      );

      throw new BadRequestException(`Authorization failed: ${result.errorMessage}`);
    }

    const preAuthExpiry = dto.preAuthExpiresAt
      ? new Date(dto.preAuthExpiresAt)
      : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // Default 7 days

    const [payment] = await this.db
      .insert(payments)
      .values({
        folioId: dto.folioId,
        propertyId: dto.propertyId,
        method: 'credit_card',
        amount: dto.amount,
        currencyCode: dto.currencyCode,
        status: 'authorized',
        isPreAuthorization: true,
        preAuthExpiresAt: preAuthExpiry,
        gatewayProvider: dto.gatewayProvider,
        gatewayPaymentToken: dto.gatewayPaymentToken,
        gatewayTransactionId: result.transactionId,
        cardLastFour: dto.cardLastFour,
        cardBrand: dto.cardBrand,
        notes: dto.notes,
      })
      .returning();

    // Do NOT recalculate balance — pre-auth is a hold, not a capture
    await this.webhookService.emit(
      'payment.received',
      'payment',
      payment.id,
      { folioId: dto.folioId, status: 'authorized', amount: payment.amount },
      dto.propertyId,
    );

    return payment;
  }

  /**
   * Capture an authorized payment.
   *
   * Concurrency-safe two-phase flow:
   *  1. Atomic conditional UPDATE from `authorized` → `captured` in a short tx.
   *     If the update matches zero rows, another request already claimed it.
   *  2. Call Stripe OUTSIDE the tx with an idempotency key. If Stripe fails,
   *     revert the row back to `authorized` so the client can retry.
   *
   * This prevents the classic read-then-act race where two requests both see
   * `authorized` and both call Stripe. The DB wins the race; Stripe's
   * idempotency key provides a second line of defense if a retry slips past.
   */
  async capturePayment(id: string, propertyId: string) {
    // Phase 1: atomically claim the payment (authorized → captured)
    const [claimed] = await this.db
      .update(payments)
      .set({
        status: 'captured',
        processedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(payments.id, id),
          eq(payments.propertyId, propertyId),
          eq(payments.status, 'authorized'),
        ),
      )
      .returning();

    if (!claimed) {
      // Either the payment doesn't exist, doesn't belong to this property,
      // or isn't in `authorized` state. Distinguish for a useful error.
      const existing = await this.db
        .select()
        .from(payments)
        .where(and(eq(payments.id, id), eq(payments.propertyId, propertyId)));
      if (!existing || existing.length === 0) {
        throw new NotFoundException(`Payment ${id} not found`);
      }
      throw new ConflictException(
        `Cannot capture payment with status '${existing[0].status}' (expected 'authorized')`,
      );
    }

    // Phase 2: call Stripe outside the DB tx with an idempotency key
    const result = await this.gateway.capture(
      claimed.gatewayTransactionId,
      new Decimal(claimed.amount).toNumber(),
      { idempotencyKey: `cap_${id}` },
    );

    if (!result.success) {
      // Revert to authorized so the caller can retry
      await this.db
        .update(payments)
        .set({ status: 'authorized', processedAt: null, updatedAt: new Date() })
        .where(and(eq(payments.id, id), eq(payments.propertyId, propertyId)));
      throw new BadRequestException(`Capture failed: ${result.errorMessage}`);
    }

    await this.folioService.recalculateBalance(claimed.folioId, propertyId);

    await this.webhookService.emit(
      'payment.received',
      'payment',
      claimed.id,
      { folioId: claimed.folioId, status: 'captured', amount: claimed.amount },
      propertyId,
    );

    return claimed;
  }

  /**
   * Void an authorized payment. Same two-phase concurrency-safe pattern as capture.
   */
  async voidPayment(id: string, propertyId: string) {
    // Phase 1: atomically claim the payment (authorized → voided)
    const [claimed] = await this.db
      .update(payments)
      .set({ status: 'voided', updatedAt: new Date() })
      .where(
        and(
          eq(payments.id, id),
          eq(payments.propertyId, propertyId),
          eq(payments.status, 'authorized'),
        ),
      )
      .returning();

    if (!claimed) {
      const existing = await this.db
        .select()
        .from(payments)
        .where(and(eq(payments.id, id), eq(payments.propertyId, propertyId)));
      if (!existing || existing.length === 0) {
        throw new NotFoundException(`Payment ${id} not found`);
      }
      throw new ConflictException(
        `Cannot void payment with status '${existing[0].status}' (expected 'authorized')`,
      );
    }

    const result = await this.gateway.void(claimed.gatewayTransactionId, {
      idempotencyKey: `void_${id}`,
    });

    if (!result.success) {
      await this.db
        .update(payments)
        .set({ status: 'authorized', updatedAt: new Date() })
        .where(and(eq(payments.id, id), eq(payments.propertyId, propertyId)));
      throw new BadRequestException(`Void failed: ${result.errorMessage}`);
    }

    await this.webhookService.emit(
      'payment.failed',
      'payment',
      claimed.id,
      { folioId: claimed.folioId, status: 'voided' },
      propertyId,
    );

    return claimed;
  }

  /**
   * Refund a captured/settled payment.
   *
   * Parent row stays `captured` (or `settled`); net folio effect comes from a
   * negative child row. Row lock serializes concurrent partial refunds.
   */
  async refundPayment(id: string, propertyId: string, amount?: string) {
    const prepared = await this.db.transaction(async (tx: any) => {
      const [original] = await tx
        .select()
        .from(payments)
        .where(and(eq(payments.id, id), eq(payments.propertyId, propertyId)))
        .for('update');

      if (!original) {
        throw new NotFoundException(`Payment ${id} not found`);
      }

      if (!['captured', 'settled', 'partially_refunded'].includes(original.status)) {
        throw new BadRequestException(
          `Cannot refund payment with status '${original.status}'`,
        );
      }

      const refundAmount = amount ?? original.amount;
      const refundAmountInTx = new Decimal(refundAmount);
      const originalAmountDec = new Decimal(original.amount);
      if (refundAmountInTx.lte(0)) {
        throw new BadRequestException('Refund amount must be positive');
      }

      const existingRefunds = await tx
        .select()
        .from(payments)
        .where(
          and(
            eq(payments.originalPaymentId, id),
            eq(payments.propertyId, propertyId),
          ),
        );
      const alreadyRefundedDec = sumRefundChildren(existingRefunds ?? []);
      const remainingDec = originalAmountDec.minus(alreadyRefundedDec);

      if (remainingDec.lte(0)) {
        throw new BadRequestException(`Payment ${id} is already fully refunded`);
      }

      if (refundAmountInTx.gt(remainingDec)) {
        throw new BadRequestException(
          `Refund amount ${refundAmountInTx.toFixed(2)} exceeds remaining refundable amount ${remainingDec.toFixed(2)}`,
        );
      }

      const totalAfterDec = alreadyRefundedDec.plus(refundAmountInTx);
      return { original, totalAfterDec, refundAmountDec: refundAmountInTx };
    });

    const { original, totalAfterDec, refundAmountDec: refundDec } = prepared;

    const idempotencyKey = `ref_${id}_${totalAfterDec.toFixed(2)}`;
    const result = await this.gateway.refund(
      original.gatewayTransactionId,
      refundDec.toNumber(),
      { idempotencyKey },
    );

    if (!result.success) {
      throw new BadRequestException(`Refund failed: ${result.errorMessage}`);
    }

    const refundRowAmount = refundDec.negated().toFixed(2);
    const refund = await this.db.transaction(async (tx: any) => {
      const [locked] = await tx
        .select()
        .from(payments)
        .where(and(eq(payments.id, id), eq(payments.propertyId, propertyId)))
        .for('update');

      if (!locked) {
        throw new NotFoundException(`Payment ${id} not found`);
      }

      if (result.transactionId) {
        const [existingByGateway] = await tx
          .select()
          .from(payments)
          .where(
            and(
              eq(payments.gatewayTransactionId, result.transactionId),
              eq(payments.propertyId, propertyId),
            ),
          );
        if (existingByGateway) {
          return { row: existingByGateway, isNew: false };
        }
      }

      const existingRefunds = await tx
        .select()
        .from(payments)
        .where(
          and(
            eq(payments.originalPaymentId, id),
            eq(payments.propertyId, propertyId),
          ),
        );
      const alreadyRefundedDec = sumRefundChildren(existingRefunds ?? []);
      const remainingDec = new Decimal(locked.amount).minus(alreadyRefundedDec);

      if (refundDec.gt(remainingDec)) {
        // Stripe webhook may have recorded this refund between prepare and insert.
        if (alreadyRefundedDec.gte(totalAfterDec)) {
          const latest = existingRefunds[existingRefunds.length - 1];
          if (latest) {
            return { row: latest, isNew: false };
          }
        }
        throw new ConflictException(
          `Payment ${id} refundable amount changed during gateway refund`,
        );
      }

      const [row] = await tx
        .insert(payments)
        .values({
          folioId: locked.folioId,
          propertyId,
          method: locked.method,
          amount: refundRowAmount,
          currencyCode: locked.currencyCode,
          status: 'captured',
          originalPaymentId: id,
          gatewayProvider: locked.gatewayProvider,
          gatewayTransactionId: result.transactionId,
          processedAt: new Date(),
          notes: `Refund of payment ${id}`,
        })
        .returning();

      return { row, isNew: true };
    });

    if (refund.isNew) {
      await this.folioService.recalculateBalance(original.folioId, propertyId);

      await this.webhookService.emit(
        'payment.refunded',
        'payment',
        refund.row.id,
        { folioId: original.folioId, originalPaymentId: id, refundAmount: refundDec.toFixed(2) },
        propertyId,
      );
    }

    return refund.row;
  }

  /**
   * Correction matrix (KB 14.1). Picks the LEGAL reversal op from payment state
   * and (if an override is supplied) rejects an illegal op:
   *
   *  - `authorized` (uncaptured gateway hold)            → VOID
   *  - `cash` within 24h void window                     → VOID (no gateway call)
   *  - captured/settled/partially_refunded card payment  → REFUND only
   *  - otherwise (cash past window, record-only tenders)  → ADJUST
   *    (negative payment child row on the folio, same ledger model as refunds)
   *
   * [ASSUMPTION KB 14.1] cash void window = 24h / same business day.
   */
  async correctPayment(
    id: string,
    propertyId: string,
    opOverride?: 'void' | 'refund' | 'adjust',
  ) {
    const payment = await this.findById(id, propertyId);

    const CASH_VOID_WINDOW_MS = 24 * 60 * 60 * 1000;
    const isCard = CARD_METHODS.includes(payment.method);
    const ageMs = Date.now() - new Date(payment.createdAt).getTime();
    const cashWithinWindow =
      payment.method === 'cash' && ageMs <= CASH_VOID_WINDOW_MS;

    // Determine the single legal op from state.
    let legalOp: 'void' | 'refund' | 'adjust';
    if (payment.status === 'authorized') {
      legalOp = 'void';
    } else if (cashWithinWindow) {
      legalOp = 'void';
    } else if (
      isCard &&
      ['captured', 'settled', 'partially_refunded'].includes(payment.status)
    ) {
      legalOp = 'refund';
    } else {
      legalOp = 'adjust';
    }

    if (opOverride && opOverride !== legalOp) {
      if (
        opOverride === 'void' &&
        isCard &&
        ['captured', 'settled', 'partially_refunded'].includes(payment.status)
      ) {
        throw new BadRequestException(
          'A captured card payment cannot be voided — it must be refunded (KB 14.1)',
        );
      }
      throw new BadRequestException(
        `Operation '${opOverride}' is not legal for payment ${id} in state '${payment.status}' (method '${payment.method}'). Legal op is '${legalOp}'.`,
      );
    }

    const op = opOverride ?? legalOp;

    if (op === 'void') {
      // Gateway-backed void uses the two-phase voidPayment. Cash has no gateway:
      // transition the row to 'voided' directly (no gateway call).
      let result: any;
      if (payment.status === 'authorized' && isCard) {
        result = await this.voidPayment(id, propertyId);
      } else {
        const [voided] = await this.db
          .update(payments)
          .set({ status: 'voided', updatedAt: new Date() })
          .where(
            and(
              eq(payments.id, id),
              eq(payments.propertyId, propertyId),
              eq(payments.status, payment.status),
            ),
          )
          .returning();
        if (!voided) {
          throw new ConflictException(
            `Payment ${id} is no longer in '${payment.status}' state — concurrent correction?`,
          );
        }
        if (voided.folioId) {
          await this.folioService.recalculateBalance(voided.folioId, propertyId);
        }
        await this.webhookService.emit(
          'payment.failed',
          'payment',
          voided.id,
          { folioId: voided.folioId, status: 'voided' },
          propertyId,
        );
        result = voided;
      }
      await this.webhookService.emit(
        'payment.corrected',
        'payment',
        id,
        { op: 'void', method: payment.method },
        propertyId,
      );
      return { op: 'void', payment: result };
    }

    if (op === 'refund') {
      const result = await this.refundPayment(id, propertyId);
      await this.webhookService.emit(
        'payment.corrected',
        'payment',
        id,
        { op: 'refund', method: payment.method },
        propertyId,
      );
      return { op: 'refund', refund: result };
    }

    // op === 'adjust': negative payment child (same ledger model as refunds).
    if (!payment.folioId) {
      throw new BadRequestException(
        `Cannot adjust payment ${id}: it is not linked to a folio`,
      );
    }

    const adjustment = await this.db.transaction(async (tx: any) => {
      const [locked] = await tx
        .select()
        .from(payments)
        .where(and(eq(payments.id, id), eq(payments.propertyId, propertyId)))
        .for('update');

      if (!locked) {
        throw new NotFoundException(`Payment ${id} not found`);
      }

      // When the parent is voided/failed/etc., it is excluded from folioPaymentSumWhere
      // but a captured child would still net — use a compensating charge instead.
      if (!parentCountsTowardFolioBalance(locked.status)) {
        return { useCharge: true as const, locked };
      }

      const adjustmentAmount = new Decimal(locked.amount).negated().toFixed(2);
      const [row] = await tx
        .insert(payments)
        .values({
          folioId: locked.folioId,
          propertyId,
          method: locked.method,
          amount: adjustmentAmount,
          currencyCode: locked.currencyCode,
          status: 'captured',
          originalPaymentId: id,
          processedAt: new Date(),
          notes: `Correction of payment ${id}`,
        })
        .returning();

      await this.folioService.recalculateBalance(locked.folioId!, propertyId, tx);
      return { useCharge: false as const, row, adjustmentAmount };
    });

    if (adjustment.useCharge) {
      const adjustmentAmount = new Decimal(adjustment.locked.amount).negated().toFixed(2);
      const charge = await this.folioService.postCharge(adjustment.locked.folioId!, {
        propertyId,
        type: 'adjustment',
        description: `Correction of payment ${id}`,
        amount: adjustmentAmount,
        currencyCode: adjustment.locked.currencyCode,
        serviceDate: new Date().toISOString(),
        skipTaxCalculation: true,
      });
      await this.webhookService.emit(
        'payment.corrected',
        'payment',
        id,
        { op: 'adjust', method: payment.method, adjustmentAmount },
        propertyId,
      );
      return { op: 'adjust', adjustment: charge };
    }

    await this.webhookService.emit(
      'payment.corrected',
      'payment',
      id,
      { op: 'adjust', method: payment.method, adjustmentAmount: adjustment.adjustmentAmount },
      propertyId,
    );
    return { op: 'adjust', adjustment: adjustment.row };
  }

  async findById(id: string, propertyId: string) {
    const [payment] = await this.db
      .select()
      .from(payments)
      .where(and(eq(payments.id, id), eq(payments.propertyId, propertyId)));
    if (!payment) {
      throw new NotFoundException(`Payment ${id} not found`);
    }
    return payment;
  }

  async list(dto: ListPaymentsDto) {
    const conditions: any[] = [eq(payments.propertyId, dto.propertyId)];

    if (dto.folioId) conditions.push(eq(payments.folioId, dto.folioId));
    if (dto.status) conditions.push(eq(payments.status, dto.status as any));
    if (dto.method) conditions.push(eq(payments.method, dto.method as any));

    const page = dto.page ?? 1;
    const limit = dto.limit ?? 20;
    const offset = (page - 1) * limit;
    const whereClause = and(...conditions);

    const [data, countResult] = await Promise.all([
      this.db
        .select()
        .from(payments)
        .where(whereClause)
        .limit(limit)
        .offset(offset)
        .orderBy(payments.createdAt),
      this.db
        .select({ count: sql<number>`count(*)` })
        .from(payments)
        .where(whereClause),
    ]);

    return {
      data,
      total: Number(countResult[0]?.count ?? 0),
      page,
      limit,
    };
  }
}
