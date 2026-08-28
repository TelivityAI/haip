import {
  Injectable,
  Logger,
  BadRequestException,
  ConflictException,
  Inject,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { eq, and } from 'drizzle-orm';
import { Decimal } from 'decimal.js';
import {
  auditLogs,
  bookingRequests,
  bookingRequestPaymentResolutions,
  payments,
} from './booking-request-db.js';
import { DRIZZLE } from '@telivityhaip/database';
import { FolioServicePort, WebhookServicePort } from '../module/ports.js';
import type Stripe from 'stripe';
import { reconcileBookingRequestPaymentAllocations } from './booking-request-allocation-reconciler.js';
import { ensureBookingRequestFinancialConsequence } from './booking-request-payment-consequence.js';
import {
  classifyHaipMetadata,
  decidePaymentIntentTransition,
  decideRefundTransition,
  paymentIntentCorrelation,
  refundCorrelation,
  type PaymentIntentEvent,
  type PaymentIntentCorrelation,
  type PaymentIntentLedgerStatus,
  type RefundProviderStatus,
} from '@telivityhaip/shared';
import type {
  BookingRequestStripeHandler as IBookingRequestStripeHandler,
  BookingRequestStripePaymentRow,
} from '@telivityhaip/shared';

/**
 * Stripe webhook handler for booking-request scoped payments.
 * Registered when HAIP_BOOKING_REQUESTS=true via BOOKING_REQUEST_STRIPE_HANDLER.
 */
@Injectable()
export class BookingRequestStripeHandler implements IBookingRequestStripeHandler {
  private readonly logger = new Logger(BookingRequestStripeHandler.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: any,
    @Inject(WebhookServicePort) private readonly webhookService: WebhookServicePort,
    @Inject(FolioServicePort) private readonly folioService: FolioServicePort,
    private readonly configService: ConfigService,
  ) {}

  async handlePaymentIntentSucceeded(
    pi: Stripe.PaymentIntent,
    _payment: BookingRequestStripePaymentRow,
  ): Promise<void> {
    await this.finalizePaymentIntent(pi, 'succeeded');
  }

  async handlePaymentIntentFailed(
    pi: Stripe.PaymentIntent,
    _payment: BookingRequestStripePaymentRow,
  ): Promise<void> {
    await this.finalizePaymentIntent(pi, 'payment_failed');
  }

  async handlePaymentIntentCanceled(
    pi: Stripe.PaymentIntent,
    _payment: BookingRequestStripePaymentRow,
  ): Promise<void> {
    await this.finalizePaymentIntent(pi, 'canceled');
  }

  async handlePaymentIntentProcessing(
    pi: Stripe.PaymentIntent,
    _payment: BookingRequestStripePaymentRow,
  ): Promise<void> {
    await this.finalizePaymentIntent(pi, 'processing');
  }

  async handlePaymentIntentRequiresAction(
    pi: Stripe.PaymentIntent,
    _payment: BookingRequestStripePaymentRow,
  ): Promise<void> {
    await this.finalizePaymentIntent(pi, 'requires_action');
  }

  async handleChargeRefunded(
    charge: Stripe.Charge,
    _payment: BookingRequestStripePaymentRow,
  ): Promise<void> {
    await this.handleBookingRequestChargeRefunded(charge);
  }

  private async finalizePaymentIntent(pi: Stripe.PaymentIntent, event: PaymentIntentEvent) {
    const ownership = classifyHaipMetadata(pi.metadata, paymentIntentCorrelation);
    if (ownership.ownership === 'owned-malformed') throw ownership.error;
    const correlation = ownership.ownership === 'owned-valid'
      ? ownership.correlation
      : undefined;
    let initial = await this.findPaymentByGatewayTransactionId(pi.id);
    const linkedByGatewayTransactionId = initial != null;
    if (!initial) {
      if (ownership.ownership === 'external') return;
      initial = await this.findPaymentByCorrelation(ownership.correlation);
      if (!initial) {
        throw new ConflictException(
          `Stripe PaymentIntent ${pi.id} metadata does not identify a pending payment`,
        );
      }
    }

    const outcome = await this.db.transaction(async (tx: any) => {
      let request: typeof bookingRequests.$inferSelect | undefined;
      if (initial.bookingRequestId) {
        const requests = await tx
          .select()
          .from(bookingRequests)
          .where(and(
            eq(bookingRequests.id, initial.bookingRequestId),
            eq(bookingRequests.propertyId, initial.propertyId),
          ))
          .for('update');
        request = requests.find((row: typeof bookingRequests.$inferSelect) =>
          row.id === initial.bookingRequestId && row.propertyId === initial.propertyId);
        if (!request) {
          throw new ConflictException(`Booking request ${initial.bookingRequestId} not found`);
        }
      }
      const lockedRows = await tx
        .select()
        .from(payments)
        .where(and(eq(payments.id, initial.id), eq(payments.propertyId, initial.propertyId)))
        .for('update');
      let payment = lockedRows.find((row: typeof payments.$inferSelect) =>
        row.id === initial.id && row.propertyId === initial.propertyId);
      if (!payment) return { changed: false, payment: initial, legacyEvent: undefined };

      if (correlation) {
        if (payment.id !== correlation.paymentId
          || payment.propertyId !== correlation.propertyId
          || payment.bookingRequestId !== correlation.bookingRequestId
          || payment.gatewayProvider !== 'stripe') {
          throw new ConflictException('Stripe PaymentIntent metadata ownership is invalid');
        }
        if (!linkedByGatewayTransactionId && payment.status !== 'pending') {
          throw new ConflictException(
            `Stripe PaymentIntent metadata can bind only a pending payment, not '${payment.status}'`,
          );
        }
        if (!linkedByGatewayTransactionId
          && payment.gatewayTransactionId
          && payment.gatewayTransactionId !== pi.id) {
          throw new ConflictException(
            'Stripe PaymentIntent does not match the provider identity already bound to the payment',
          );
        }
      }

      if (request) {
        try {
          this.assertPaymentIntentBindingIdentity(pi, event, payment, request);
        } catch (error) {
          if (!(error instanceof ConflictException)) throw error;
          const reason = error.message;
          await this.auditPaymentIntentIdentityMismatch(tx, payment, event, reason);
          return {
            changed: false,
            payment,
            identityMismatch: reason,
            legacyEvent: undefined,
          };
        }
      }

      if (correlation) {
        if (!payment.gatewayTransactionId) {
          const boundRows = await tx
            .update(payments)
            .set({ gatewayTransactionId: pi.id, updatedAt: new Date() })
            .where(and(
              eq(payments.id, payment.id),
              eq(payments.propertyId, correlation.propertyId),
              eq(payments.bookingRequestId, correlation.bookingRequestId),
              eq(payments.status, 'pending'),
            ))
            .returning();
          const bound = boundRows.find((row: typeof payments.$inferSelect) => row.id === payment!.id);
          if (!bound) {
            throw new ConflictException('Stripe PaymentIntent payment identity changed while binding');
          }
          await tx.insert(auditLogs).values({
            propertyId: payment.propertyId,
            action: 'update',
            entityType: 'payment',
            entityId: payment.id,
            previousValue: {
              bookingRequestId: payment.bookingRequestId,
              gatewayTransactionId: null,
            },
            newValue: {
              bookingRequestId: payment.bookingRequestId,
              gatewayTransactionId: pi.id,
            },
            description: 'Stripe PaymentIntent provider identity bound from signed metadata',
          });
          payment = bound;
        }
      }

      if (event === 'succeeded' && request?.status === 'denied' && payment.status !== 'captured') {
        await this.auditUnexpectedProviderState(tx, payment, {
          stripeObjectId: pi.id,
          providerEvent: event,
          requestStatus: request.status,
          reason: 'Provider reported capture after booking request denial',
        });
        return { changed: false, payment, blocked: true, legacyEvent: undefined };
      }

      const decision = decidePaymentIntentTransition(
        payment.status as PaymentIntentLedgerStatus,
        event,
        request?.status,
      );
      const folioId = request?.acceptedFolioId ?? payment.folioId;
      let current = payment;
      let changed = false;
      if (decision.action === 'transition') {
        const now = new Date();
        const errorMessage = event === 'payment_failed'
          ? pi.last_payment_error?.message ?? 'Payment failed'
          : event === 'requires_action'
            ? 'Payment requires additional authentication; no recovery link is available'
            : event === 'canceled'
              ? 'Payment canceled by provider'
              : null;
        const values = {
          status: decision.status,
          folioId,
          processedAt: decision.status === 'captured' ? now : null,
          ...(errorMessage ? { notes: errorMessage } : {}),
          updatedAt: now,
        };
        const updated = await tx
          .update(payments)
          .set(values)
          .where(and(
            eq(payments.id, payment.id),
            eq(payments.propertyId, payment.propertyId),
            eq(payments.status, payment.status),
          ))
          .returning();
        current = updated.find((row: typeof payments.$inferSelect) => row.id === payment.id)
          ?? { ...payment, ...values };
        changed = true;
        await tx.insert(auditLogs).values({
          propertyId: payment.propertyId,
          action: 'update',
          entityType: 'payment',
          entityId: payment.id,
          previousValue: { status: payment.status, folioId: payment.folioId },
          newValue: { status: decision.status, folioId, stripeObjectId: pi.id },
          description: `Stripe PaymentIntent ${event} finalized monotonically`,
        });
      } else if (decision.action === 'unexpected') {
        await this.auditUnexpectedProviderState(tx, payment, {
          stripeObjectId: pi.id,
          providerEvent: event,
          currentStatus: payment.status,
        });
      } else if (folioId && payment.folioId !== folioId) {
        const updated = await tx
          .update(payments)
          .set({ folioId, updatedAt: new Date() })
          .where(and(eq(payments.id, payment.id), eq(payments.propertyId, payment.propertyId)))
          .returning();
        current = updated.find((row: typeof payments.$inferSelect) => row.id === payment.id)
          ?? { ...payment, folioId };
        await tx.insert(auditLogs).values({
          propertyId: payment.propertyId,
          action: 'update',
          entityType: 'payment',
          entityId: payment.id,
          previousValue: { bookingRequestId: payment.bookingRequestId, folioId: payment.folioId },
          newValue: { bookingRequestId: payment.bookingRequestId, folioId },
          description: 'Stripe PaymentIntent replay repaired accepted folio linkage',
        });
      }

      if (request && decision.action !== 'unexpected' && current.status !== 'pending') {
        const financialEvent = current.status === 'captured'
          ? 'payment.received' as const
          : 'payment.failed' as const;
        await ensureBookingRequestFinancialConsequence(tx, {
          event: financialEvent,
          logicalId: current.id,
          propertyId: current.propertyId,
          bookingRequestId: request.id,
          entityType: 'payment',
          entityId: current.id,
          data: {
            folioId,
            status: current.status,
            amount: current.amount,
            currencyCode: current.currencyCode,
          },
        });
      }
      if (folioId && (
        current.status === 'captured'
        || (decision.action === 'repair' && current.status !== 'pending')
      )) {
        await this.folioService.recalculateBalance(folioId, payment.propertyId, tx);
      }
      return {
        changed,
        payment: current,
        legacyEvent: request
          ? undefined
          : current.status === 'captured'
            ? 'payment.received' as const
            : decision.action === 'transition'
              ? 'payment.failed' as const
              : undefined,
      };
    });

    if (outcome.blocked) {
      throw new ConflictException(
        'Provider captured the payment after booking request denial; operator reconciliation required',
      );
    }
    if (outcome.identityMismatch) {
      throw new ConflictException(outcome.identityMismatch);
    }
    if (outcome.legacyEvent) {
      await this.webhookService.emit(
        outcome.legacyEvent,
        'payment',
        outcome.payment.id,
        { folioId: outcome.payment.folioId, status: outcome.payment.status, stripeEvent: pi.id },
        outcome.payment.propertyId,
      );
    }
  }

  private async handleBookingRequestChargeRefunded(charge: Stripe.Charge) {
    const ownership = classifyHaipMetadata(charge.metadata, paymentIntentCorrelation);
    if (ownership.ownership === 'owned-malformed') throw ownership.error;
    const correlation = ownership.ownership === 'owned-valid'
      ? ownership.correlation
      : undefined;
    const piId = typeof charge.payment_intent === 'string'
      ? charge.payment_intent
      : charge.payment_intent?.id;

    if (!piId) {
      if (ownership.ownership === 'external') return;
      throw new ConflictException(
        `Stripe charge ${charge.id} metadata does not identify a linked PaymentIntent`,
      );
    }

    const payment = await this.findPaymentByGatewayTransactionId(piId);
    if (!payment) {
      if (ownership.ownership === 'external') return;
      throw new ConflictException(
        `Stripe charge ${charge.id} metadata does not identify a linked payment`,
      );
    }

    const outcome = await this.db.transaction(async (tx: any) => {
      if (payment.bookingRequestId) {
        await tx
          .select({ id: bookingRequests.id })
          .from(bookingRequests)
          .where(and(
            eq(bookingRequests.id, payment.bookingRequestId),
            eq(bookingRequests.propertyId, payment.propertyId),
          ))
          .for('update');
      }
      const parents = await tx
        .select()
        .from(payments)
        .where(
          and(
            eq(payments.id, payment.id),
            eq(payments.propertyId, payment.propertyId),
          ),
        )
        .for('update');

      const parent = parents.find((row: typeof payments.$inferSelect) =>
        row.id === payment.id && row.propertyId === payment.propertyId);
      if (!parent) return;
      if (correlation && (
        parent.id !== correlation.paymentId
        || parent.propertyId !== correlation.propertyId
        || parent.bookingRequestId !== correlation.bookingRequestId
        || parent.gatewayProvider !== 'stripe'
      )) {
        throw new ConflictException('Stripe charge metadata ownership is invalid');
      }
      if (parent.bookingRequestId) {
        await tx.insert(auditLogs).values({
          propertyId: parent.propertyId,
          action: 'update',
          entityType: 'payment',
          entityId: parent.id,
          newValue: {
            requestId: parent.bookingRequestId,
            paymentId: parent.id,
            stripeChargeId: charge.id,
            cumulativeRefundMinorUnits: charge.amount_refunded,
          },
          description: 'Stripe charge.refunded observed as reconciliation signal only',
        });
        await reconcileBookingRequestPaymentAllocations(tx, {
          bookingRequestId: parent.bookingRequestId,
          propertyId: parent.propertyId,
          payment: parent,
        });
        const requestFolio = (await tx.select().from(bookingRequests).where(and(
          eq(bookingRequests.id, parent.bookingRequestId),
          eq(bookingRequests.propertyId, parent.propertyId),
        )))[0]?.acceptedFolioId;
        const folioId = requestFolio ?? parent.folioId;
        if (folioId) {
          await this.folioService.recalculateBalance(folioId, parent.propertyId, tx);
        }
        return { movement: undefined };
      }

      if (charge.currency.trim().toUpperCase() !== parent.currencyCode.trim().toUpperCase()) {
        throw new ConflictException('Stripe charge refund currency does not match payment');
      }
      const children = await tx
        .select()
        .from(payments)
        .where(and(
          eq(payments.propertyId, parent.propertyId),
          eq(payments.originalPaymentId, parent.id),
          eq(payments.status, 'captured'),
      ));
      const cumulative = this.fromStripeMinorUnits(charge.amount_refunded, charge.currency);
      if (cumulative.gt(new Decimal(parent.amount))) {
        throw new ConflictException('Stripe charge refund exceeds captured payment amount');
      }
      const alreadyPosted = children.reduce(
        (total: Decimal, child: typeof payments.$inferSelect) =>
          total.plus(new Decimal(child.amount).abs()),
        new Decimal(0),
      );
      const delta = cumulative.minus(alreadyPosted);
      if (delta.lte(0)) return { movement: undefined };

      const [movement] = await tx.insert(payments).values({
        propertyId: parent.propertyId,
        folioId: parent.folioId,
        bookingRequestId: null,
        idempotencyKey: `stripe-charge-refund:${charge.id}:${charge.amount_refunded}`,
        method: parent.method,
        status: 'captured',
        amount: delta.negated().toFixed(2),
        currencyCode: parent.currencyCode,
        gatewayProvider: 'stripe',
        gatewayTransactionId: `stripe_refund:${charge.id}:${charge.amount_refunded}`,
        originalPaymentId: parent.id,
        notes: `Stripe charge refund ${charge.id} reconciled at ${charge.amount_refunded}`,
        processedAt: new Date(),
      }).returning();
      if (!movement) throw new ConflictException('Stripe charge refund movement could not be persisted');

      const folioId = parent.folioId;
      if (folioId) {
        await this.folioService.recalculateBalance(folioId, parent.propertyId, tx);
      }
      return { movement };
    });
    if (outcome?.movement) {
      await this.webhookService.emit(
        'payment.refunded',
        'payment',
        outcome.movement.id,
        {
          folioId: outcome.movement.folioId,
          originalPaymentId: outcome.movement.originalPaymentId,
          refundAmount: new Decimal(outcome.movement.amount).abs().toFixed(2),
        },
        outcome.movement.propertyId,
      );
    }
  }

  async handleRefundUpdated(refund: Stripe.Refund): Promise<void> {
    await this.finalizeRefundUpdated(refund);
  }

  private async finalizeRefundUpdated(refund: Stripe.Refund) {
    const linkedPayment = await this.findPaymentByGatewayTransactionId(refund.id);
    const ownership = classifyHaipMetadata(refund.metadata, refundCorrelation);
    if (ownership.ownership === 'external') {
      if (!linkedPayment) return;
      if (!linkedPayment.bookingRequestId) return;
      throw new ConflictException(
        'Stripe refund is linked to a payment but missing exact HAIP correlation metadata',
      );
    }
    if (ownership.ownership === 'owned-malformed') throw ownership.error;
    const correlation = ownership.correlation;
    const providerStatus = this.refundStatus(refund.status);
    const result = await this.db.transaction(async (tx: any) => {
      const requestRows = await tx
        .select()
        .from(bookingRequests)
        .where(and(
          eq(bookingRequests.id, correlation.bookingRequestId),
          eq(bookingRequests.propertyId, correlation.propertyId),
        ))
        .for('update');
      const request = requestRows.find((row: typeof bookingRequests.$inferSelect) =>
        row.id === correlation.bookingRequestId && row.propertyId === correlation.propertyId);
      if (!request) throw new ConflictException('Stripe refund booking request correlation is invalid');

      const parentRows = await tx
        .select()
        .from(payments)
        .where(and(
          eq(payments.id, correlation.paymentId),
          eq(payments.propertyId, correlation.propertyId),
          eq(payments.bookingRequestId, correlation.bookingRequestId),
        ))
        .for('update');
      const parent = parentRows.find((row: typeof payments.$inferSelect) =>
        row.id === correlation.paymentId
        && row.propertyId === correlation.propertyId
        && row.bookingRequestId === correlation.bookingRequestId);
      if (!parent) throw new ConflictException('Stripe refund payment correlation is invalid');

      const claimRows = await tx
        .select()
        .from(bookingRequestPaymentResolutions)
        .where(and(
          eq(bookingRequestPaymentResolutions.id, correlation.claimId),
          eq(bookingRequestPaymentResolutions.propertyId, correlation.propertyId),
          eq(bookingRequestPaymentResolutions.bookingRequestId, correlation.bookingRequestId),
          eq(bookingRequestPaymentResolutions.paymentId, correlation.paymentId),
        ))
        .for('update');
      const claim = claimRows.find((row: typeof bookingRequestPaymentResolutions.$inferSelect) =>
        row.id === correlation.claimId
        && row.propertyId === correlation.propertyId
        && row.bookingRequestId === correlation.bookingRequestId
        && row.paymentId === correlation.paymentId);
      if (!claim || claim.type !== 'refund') {
        throw new ConflictException('Stripe refund claim correlation is invalid');
      }
      if (claim.providerTransactionId && claim.providerTransactionId !== refund.id) {
        throw new ConflictException('Stripe refund ID does not match the durable refund claim');
      }
      const refundPaymentIntentId = typeof refund.payment_intent === 'string'
        ? refund.payment_intent
        : refund.payment_intent?.id;
      if (refundPaymentIntentId && refundPaymentIntentId !== parent.gatewayTransactionId) {
        throw new ConflictException('Stripe refund PaymentIntent does not match the claimed payment');
      }
      const amount = this.fromStripeMinorUnits(refund.amount, refund.currency);
      if (!amount.eq(claim.amount)
        || refund.currency.toUpperCase() !== parent.currencyCode.toUpperCase()) {
        throw new ConflictException('Stripe refund amount or currency does not match the claim');
      }

      const decision = decideRefundTransition(claim.status as 'pending' | 'completed' | 'failed', providerStatus);
      if (decision.action === 'record_pending') {
        await tx.update(bookingRequestPaymentResolutions).set({
          providerTransactionId: refund.id,
          providerStatus,
          attempts: (claim.attempts ?? 0) + 1,
          lastError: `Stripe refund is ${providerStatus}`,
          updatedAt: new Date(),
        }).where(and(
          eq(bookingRequestPaymentResolutions.id, claim.id),
          eq(bookingRequestPaymentResolutions.propertyId, claim.propertyId),
          eq(bookingRequestPaymentResolutions.status, 'pending'),
        ));
        await tx.insert(auditLogs).values({
          propertyId: claim.propertyId,
          action: 'update',
          entityType: 'booking_request_payment_resolution',
          entityId: claim.id,
          previousValue: { status: claim.status, providerStatus: claim.providerStatus },
          newValue: { status: 'pending', providerStatus, stripeRefundId: refund.id },
          description: 'Stripe refund remains pending under exact durable claim',
        });
        return { blocked: false };
      }
      if (decision.action === 'unexpected') {
        await this.auditUnexpectedRefundState(tx, claim, refund.id, providerStatus);
        return { blocked: false };
      }
      if (decision.status === 'failed') {
        const now = new Date();
        await tx.update(bookingRequestPaymentResolutions).set({
          status: 'failed',
          providerTransactionId: refund.id,
          providerStatus,
          attempts: (claim.attempts ?? 0) + 1,
          lastError: refund.failure_reason ?? `Stripe refund ${providerStatus}`,
          resolvedAt: now,
          updatedAt: now,
        }).where(and(
          eq(bookingRequestPaymentResolutions.id, claim.id),
          eq(bookingRequestPaymentResolutions.propertyId, claim.propertyId),
          eq(bookingRequestPaymentResolutions.status, 'pending'),
        ));
        await tx.insert(auditLogs).values({
          propertyId: claim.propertyId,
          action: 'update',
          entityType: 'booking_request_payment_resolution',
          entityId: claim.id,
          previousValue: { status: claim.status, providerStatus: claim.providerStatus },
          newValue: { status: 'failed', providerStatus, stripeRefundId: refund.id },
          description: 'Stripe refund claim failed terminally',
        });
        await ensureBookingRequestFinancialConsequence(tx, {
          event: 'payment.failed',
          logicalId: claim.id,
          propertyId: claim.propertyId,
          bookingRequestId: claim.bookingRequestId,
          entityType: 'booking_request_payment_resolution',
          entityId: claim.id,
          data: {
            paymentId: parent.id,
            type: 'refund',
            amount: claim.amount,
            currencyCode: parent.currencyCode,
            providerStatus,
          },
        });
        return { blocked: false };
      }

      if (request.status === 'denied' && decision.action === 'transition') {
        await this.auditUnexpectedRefundState(tx, claim, refund.id, providerStatus);
        return { blocked: true };
      }
      let movement: typeof payments.$inferSelect | undefined;
      if (claim.movementId) {
        const movementRows = await tx.select().from(payments).where(and(
          eq(payments.id, claim.movementId),
          eq(payments.propertyId, claim.propertyId),
        ));
        movement = movementRows.find((row: typeof payments.$inferSelect) => row.id === claim.movementId);
      } else {
        const providerRows = await tx.select().from(payments).where(and(
          eq(payments.propertyId, claim.propertyId),
          eq(payments.gatewayTransactionId, refund.id),
        ));
        movement = providerRows.find((row: typeof payments.$inferSelect) =>
          row.gatewayTransactionId === refund.id && row.propertyId === claim.propertyId);
      }
      if (movement && (movement.originalPaymentId !== parent.id
        || !new Decimal(movement.amount).abs().eq(claim.amount))) {
        throw new ConflictException('Stripe refund ID is already linked to another ledger movement');
      }
      if (!movement) {
        [movement] = await tx.insert(payments).values({
          propertyId: parent.propertyId,
          bookingRequestId: parent.bookingRequestId,
          folioId: request.acceptedFolioId,
          idempotencyKey: claim.idempotencyKey ?? `booking-request-refund:${claim.id}`,
          method: parent.method,
          status: 'captured',
          amount: amount.negated().toFixed(2),
          currencyCode: parent.currencyCode,
          gatewayProvider: parent.gatewayProvider,
          gatewayTransactionId: refund.id,
          originalPaymentId: parent.id,
          notes: `Stripe refund ${refund.id}`,
          processedAt: new Date(),
        }).returning();
      }
      if (!movement) throw new ConflictException('Stripe refund movement could not be persisted');

      if (claim.status === 'pending') {
        const now = new Date();
        await tx.update(bookingRequestPaymentResolutions).set({
          status: 'completed',
          movementId: movement.id,
          providerTransactionId: refund.id,
          providerStatus,
          reason: `Gateway refund movement ${movement.id}`,
          attempts: (claim.attempts ?? 0) + 1,
          lastError: null,
          resolvedAt: now,
          updatedAt: now,
        }).where(and(
          eq(bookingRequestPaymentResolutions.id, claim.id),
          eq(bookingRequestPaymentResolutions.propertyId, claim.propertyId),
          eq(bookingRequestPaymentResolutions.status, 'pending'),
        ));
      }
      await tx.insert(auditLogs).values({
        propertyId: parent.propertyId,
        action: claim.status === 'pending' ? 'update' : 'create',
        entityType: 'booking_request_payment_resolution',
        entityId: claim.id,
        previousValue: { status: claim.status },
        newValue: { status: 'completed', movementId: movement.id, stripeRefundId: refund.id },
        description: 'Stripe refund finalized by exact durable claim correlation',
      });
      await reconcileBookingRequestPaymentAllocations(tx, {
        bookingRequestId: parent.bookingRequestId!,
        propertyId: parent.propertyId,
        payment: parent,
      });
      if (request.acceptedFolioId) {
        await this.folioService.recalculateBalance(request.acceptedFolioId, parent.propertyId, tx);
      }
      await ensureBookingRequestFinancialConsequence(tx, {
        event: 'payment.refunded',
        logicalId: movement.id,
        propertyId: parent.propertyId,
        bookingRequestId: parent.bookingRequestId!,
        entityType: 'payment',
        entityId: movement.id,
        data: {
          folioId: request.acceptedFolioId,
          originalPaymentId: parent.id,
          refundAmount: amount.toFixed(2),
          currencyCode: parent.currencyCode,
          resolutionId: claim.id,
        },
      });
      return { blocked: false };
    });
    if (result.blocked) {
      throw new ConflictException('Refund succeeded after booking request denial; reconciliation required');
    }
  }

  private refundStatus(status: string | null): RefundProviderStatus {
    switch (status) {
      case 'succeeded':
      case 'pending':
      case 'requires_action':
      case 'failed':
      case 'canceled':
        return status;
      default:
        throw new BadRequestException(`Unsupported Stripe refund status '${status ?? 'unknown'}'`);
    }
  }

  private async auditUnexpectedProviderState(
    tx: any,
    payment: typeof payments.$inferSelect,
    details: Record<string, unknown>,
  ): Promise<void> {
    await tx.insert(auditLogs).values({
      propertyId: payment.propertyId,
      action: 'update',
      entityType: 'payment',
      entityId: payment.id,
      previousValue: { status: payment.status },
      newValue: details,
      description: 'Unexpected Stripe PaymentIntent state ignored monotonically',
    });
  }

  private async auditPaymentIntentIdentityMismatch(
    tx: any,
    payment: typeof payments.$inferSelect,
    event: PaymentIntentEvent,
    reason: string,
  ): Promise<void> {
    await tx.insert(auditLogs).values({
      propertyId: payment.propertyId,
      action: 'update',
      entityType: 'payment',
      entityId: payment.id,
      previousValue: {
        bookingRequestId: payment.bookingRequestId,
        status: payment.status,
        folioId: payment.folioId,
      },
      newValue: {
        bookingRequestId: payment.bookingRequestId,
        providerEvent: event,
        reason: `PaymentIntent financial/provider identity mismatch: ${reason}`,
      },
      description: 'Stripe PaymentIntent identity mismatch rejected without ledger mutation',
    });
  }

  private async auditUnexpectedRefundState(
    tx: any,
    claim: typeof bookingRequestPaymentResolutions.$inferSelect,
    refundId: string,
    providerStatus: RefundProviderStatus,
  ): Promise<void> {
    await tx.insert(auditLogs).values({
      propertyId: claim.propertyId,
      action: 'update',
      entityType: 'booking_request_payment_resolution',
      entityId: claim.id,
      previousValue: { status: claim.status },
      newValue: { providerStatus, stripeRefundId: refundId },
      description: 'Unexpected Stripe refund state ignored monotonically',
    });
  }

  private assertPaymentIntentBindingIdentity(
    paymentIntent: Stripe.PaymentIntent,
    event: PaymentIntentEvent,
    payment: typeof payments.$inferSelect,
    request: typeof bookingRequests.$inferSelect | undefined,
  ): void {
    if (!request) {
      throw new ConflictException('Stripe PaymentIntent metadata requires a booking request');
    }
    const paymentCurrency = payment.currencyCode.trim().toUpperCase();
    const requestCurrency = request.currencyCode.trim().toUpperCase();
    const providerCurrency = paymentIntent.currency?.trim().toUpperCase();
    if (paymentCurrency !== requestCurrency || providerCurrency !== paymentCurrency) {
      throw new ConflictException('Stripe PaymentIntent currency identity does not match');
    }
    const expectedAmount = new Decimal(payment.amount);
    const configuredAmount = this.fromStripeMinorUnits(paymentIntent.amount, providerCurrency);
    if (!configuredAmount.eq(expectedAmount)) {
      throw new ConflictException('Stripe PaymentIntent configured amount does not match');
    }
    if (event === 'succeeded') {
      const receivedAmount = this.fromStripeMinorUnits(
        paymentIntent.amount_received,
        providerCurrency,
      );
      if (!receivedAmount.eq(expectedAmount)) {
        throw new ConflictException('Stripe PaymentIntent received amount does not match');
      }
    }
    const customerId = this.stripeObjectId(paymentIntent.customer);
    const paymentMethodId = this.stripeObjectId(paymentIntent.payment_method);
    if (!request.stripeCustomerId || customerId !== request.stripeCustomerId) {
      throw new ConflictException('Stripe PaymentIntent customer identity does not match');
    }
    if (!request.stripePaymentMethodId
      || paymentMethodId !== request.stripePaymentMethodId
      || payment.gatewayPaymentToken !== request.stripePaymentMethodId
      || payment.method !== 'credit_card') {
      throw new ConflictException('Stripe PaymentIntent payment method identity does not match');
    }
  }

  private stripeObjectId(value: string | { id: string } | null): string | null {
    return typeof value === 'string' ? value : value?.id ?? null;
  }

  private fromStripeMinorUnits(amount: number, currencyCode: string): Decimal {
    const normalized = currencyCode.trim().toUpperCase();
    let exponent: number | undefined;
    try {
      exponent = new Intl.NumberFormat('en', {
        style: 'currency',
        currency: normalized,
      }).resolvedOptions().maximumFractionDigits;
    } catch {
      throw new BadRequestException(`Unsupported Stripe currency '${currencyCode}'`);
    }
    if (exponent == null) {
      throw new BadRequestException(`Unable to resolve Stripe currency '${currencyCode}'`);
    }
    if (exponent > 2) {
      throw new BadRequestException(
        `${normalized} minor-unit exponent ${exponent} exceeds ledger storage precision`,
      );
    }
    const result = new Decimal(amount).div(new Decimal(10).pow(exponent));
    if (result.decimalPlaces() > 2) {
      throw new BadRequestException(
        `Stripe refund amount for ${normalized} exceeds ledger storage precision`,
      );
    }
    return result;
  }

  private async findPaymentByGatewayTransactionId(transactionId: string) {
    const candidates = await this.db
      .select()
      .from(payments)
      .where(and(
        eq(payments.gatewayTransactionId, transactionId),
        eq(payments.gatewayProvider, 'stripe'),
      ))
      .limit(2);
    if (candidates.length > 1) {
      throw new ConflictException(
        `Stripe PaymentIntent ${transactionId} is ambiguously linked to multiple payments`,
      );
    }
    return candidates[0] ?? null;
  }

  private async findPaymentByCorrelation(correlation: PaymentIntentCorrelation) {
    const candidates = await this.db
      .select()
      .from(payments)
      .where(and(
        eq(payments.id, correlation.paymentId),
        eq(payments.propertyId, correlation.propertyId),
        eq(payments.bookingRequestId, correlation.bookingRequestId),
        eq(payments.gatewayProvider, 'stripe'),
      ))
      .limit(2);
    if (candidates.length > 1) {
      throw new ConflictException('Stripe PaymentIntent metadata is ambiguously linked');
    }
    return candidates[0] ?? null;
  }
}
