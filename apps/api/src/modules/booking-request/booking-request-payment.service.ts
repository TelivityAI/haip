import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  auditLogs,
  bookingRequestInstallments,
  bookingRequestPaymentAllocations,
  bookingRequestPaymentResolutions,
  bookingRequests,
  payments,
} from '@telivityhaip/database';
import { createHash } from 'node:crypto';
import Decimal from 'decimal.js';
import { and, asc, eq } from 'drizzle-orm';
import type { AuditActor } from '../../common/audit/audit-actor';
import { actorFields } from '../../common/audit/audit-actor';
import { DRIZZLE } from '../../database/database.module';
import { FolioService } from '../folio/folio.service';
import {
  PAYMENT_GATEWAY,
  type PaymentGateway,
  type PaymentGatewayResult,
} from '../payment/interfaces/payment-gateway.interface';
import {
  SAVED_PAYMENT_METHOD_GATEWAY,
  type SavedPaymentMethodGateway,
} from '../payment/interfaces/saved-payment-method-gateway.interface';
import { remainingCapturedAmount } from '../payment/payment-ledger';
import { reconcileBookingRequestPaymentAllocations } from './booking-request-allocation-reconciler';
import { assertAllocationAmount, resolveInstallmentAmount } from './booking-request-money';
import type {
  AllocateBookingRequestPaymentDto,
  ChargeBookingRequestCardDto,
  CreateBookingRequestInstallmentDto,
  RecordBookingRequestExternalPaymentDto,
  RecordBookingRequestExternalReturnDto,
  RefundBookingRequestPaymentDto,
  RetainBookingRequestPaymentDto,
  UpdateBookingRequestInstallmentDto,
} from './dto/booking-request-payment.dto';

type RequestRow = typeof bookingRequests.$inferSelect;
type InstallmentRow = typeof bookingRequestInstallments.$inferSelect;
type PaymentRow = typeof payments.$inferSelect;
type ResolutionRow = typeof bookingRequestPaymentResolutions.$inferSelect;
type AllocationRow = typeof bookingRequestPaymentAllocations.$inferSelect;

type InstallmentMilestone = InstallmentRow['dueMilestone'];

const EXTERNAL_PAYMENT_METHODS = new Set([
  'credit_card',
  'debit_card',
  'cash',
  'bank_transfer',
  'pix',
  'other',
]);

@Injectable()
export class BookingRequestPaymentService {
  constructor(
    @Inject(DRIZZLE) private readonly db: any,
    @Inject(SAVED_PAYMENT_METHOD_GATEWAY)
    private readonly savedPaymentMethodGateway: SavedPaymentMethodGateway,
    @Inject(FolioService) private readonly folioService: FolioService,
    @Inject(PAYMENT_GATEWAY) private readonly paymentGateway: PaymentGateway,
  ) {}

  async listInstallments(bookingRequestId: string, propertyId: string) {
    await this.findRequest(this.db, bookingRequestId, propertyId);
    const rows = await this.db
      .select()
      .from(bookingRequestInstallments)
      .where(and(
        eq(bookingRequestInstallments.bookingRequestId, bookingRequestId),
        eq(bookingRequestInstallments.propertyId, propertyId),
      ))
      .orderBy(asc(bookingRequestInstallments.sortOrder));
    return rows.filter((row: InstallmentRow) =>
      row.propertyId === propertyId && row.bookingRequestId === bookingRequestId);
  }

  async listPayments(bookingRequestId: string, propertyId: string) {
    await this.findRequest(this.db, bookingRequestId, propertyId);
    const [movementRows, allocationRows, resolutionRows] = await Promise.all([
      this.db
        .select()
        .from(payments)
        .where(and(
          eq(payments.bookingRequestId, bookingRequestId),
          eq(payments.propertyId, propertyId),
        )),
      this.db
        .select()
        .from(bookingRequestPaymentAllocations)
        .where(and(
          eq(bookingRequestPaymentAllocations.bookingRequestId, bookingRequestId),
          eq(bookingRequestPaymentAllocations.propertyId, propertyId),
        )),
      this.db
        .select()
        .from(bookingRequestPaymentResolutions)
        .where(and(
          eq(bookingRequestPaymentResolutions.bookingRequestId, bookingRequestId),
          eq(bookingRequestPaymentResolutions.propertyId, propertyId),
        )),
    ]);
    return {
      movements: movementRows
        .filter((row: PaymentRow) =>
          row.propertyId === propertyId && row.bookingRequestId === bookingRequestId)
        .map((row: PaymentRow) => this.paymentResponse(row)),
      allocations: allocationRows.filter((row: AllocationRow) =>
        row.propertyId === propertyId && row.bookingRequestId === bookingRequestId),
      resolutions: resolutionRows.filter((row: ResolutionRow) =>
        row.propertyId === propertyId && row.bookingRequestId === bookingRequestId),
    };
  }

  async createInstallment(
    bookingRequestId: string,
    propertyId: string,
    input: CreateBookingRequestInstallmentDto,
    actor?: AuditActor,
  ) {
    return this.db.transaction(async (tx: any) => {
      const request = await this.findRequest(tx, bookingRequestId, propertyId, true);
      this.assertNotDenied(request);
      if (this.requestTotal(request).lte(0)) {
        throw new ConflictException('A zero-total booking request cannot have installments');
      }
      const normalized = this.normalizeInstallment(request, input);
      const [created] = await tx
        .insert(bookingRequestInstallments)
        .values({
          propertyId,
          bookingRequestId,
          ...normalized,
          allocatedAmount: '0.00',
          status: 'unpaid',
        })
        .returning();
      await this.audit(tx, {
        propertyId,
        action: 'create',
        entityType: 'booking_request_installment',
        entityId: created.id,
        actor,
        newValue: this.installmentAuditValue(created),
        description: 'Booking request installment created',
      });
      return created;
    });
  }

  async updateInstallment(
    bookingRequestId: string,
    installmentId: string,
    propertyId: string,
    input: UpdateBookingRequestInstallmentDto,
    actor?: AuditActor,
  ) {
    return this.db.transaction(async (tx: any) => {
      const request = await this.findRequest(tx, bookingRequestId, propertyId, true);
      this.assertNotDenied(request);
      if (this.requestTotal(request).lte(0)) {
        throw new ConflictException('A zero-total booking request cannot be allocated');
      }
      const existing = await this.findInstallment(
        tx,
        bookingRequestId,
        installmentId,
        propertyId,
        true,
      );
      const persistedAllocation = await this.installmentAllocationTotal(
        tx,
        bookingRequestId,
        installmentId,
        propertyId,
      );
      if (new Decimal(existing.allocatedAmount).gt(0) || persistedAllocation.gt(0)) {
        throw new ConflictException('An allocated installment cannot be edited');
      }

      const merged: CreateBookingRequestInstallmentDto = {
        label: input.label ?? existing.label,
        sortOrder: input.sortOrder ?? existing.sortOrder,
        dueMilestone: input.dueMilestone ?? existing.dueMilestone,
        dueDate: input.dueDate ?? existing.dueDate ?? undefined,
        fixedAmount: input.fixedAmount ?? existing.fixedAmount ?? undefined,
        percentage: input.percentage ?? existing.percentage ?? undefined,
      };
      if (input.fixedAmount != null) merged.percentage = undefined;
      if (input.percentage != null) merged.fixedAmount = undefined;
      if (merged.dueMilestone !== 'date') merged.dueDate = undefined;
      const normalized = this.normalizeInstallment(request, merged);
      const updatedAt = new Date();
      const candidates = await tx
        .update(bookingRequestInstallments)
        .set({ ...normalized, updatedAt })
        .where(and(
          eq(bookingRequestInstallments.id, installmentId),
          eq(bookingRequestInstallments.bookingRequestId, bookingRequestId),
          eq(bookingRequestInstallments.propertyId, propertyId),
        ))
        .returning();
      const updated = candidates.find((row: InstallmentRow) =>
        row.id === installmentId
        && row.bookingRequestId === bookingRequestId
        && row.propertyId === propertyId) ?? candidates[0];
      if (!updated) throw new NotFoundException(`Installment ${installmentId} not found`);
      await this.audit(tx, {
        propertyId,
        action: 'update',
        entityType: 'booking_request_installment',
        entityId: installmentId,
        actor,
        previousValue: this.installmentAuditValue(existing),
        newValue: this.installmentAuditValue(updated),
        description: 'Booking request installment updated',
      });
      return updated;
    });
  }

  async deleteInstallment(
    bookingRequestId: string,
    installmentId: string,
    propertyId: string,
    actor?: AuditActor,
  ): Promise<{ deleted: true; installmentId: string }> {
    return this.db.transaction(async (tx: any) => {
      const request = await this.findRequest(tx, bookingRequestId, propertyId, true);
      this.assertNotDenied(request);
      const existing = await this.findInstallment(
        tx,
        bookingRequestId,
        installmentId,
        propertyId,
        true,
      );
      const persistedAllocation = await this.installmentAllocationTotal(
        tx,
        bookingRequestId,
        installmentId,
        propertyId,
      );
      if (new Decimal(existing.allocatedAmount).gt(0) || persistedAllocation.gt(0)) {
        throw new ConflictException('An allocated installment cannot be deleted');
      }
      await tx
        .delete(bookingRequestInstallments)
        .where(and(
          eq(bookingRequestInstallments.id, installmentId),
          eq(bookingRequestInstallments.bookingRequestId, bookingRequestId),
          eq(bookingRequestInstallments.propertyId, propertyId),
        ));
      await this.audit(tx, {
        propertyId,
        action: 'delete',
        entityType: 'booking_request_installment',
        entityId: installmentId,
        actor,
        previousValue: this.installmentAuditValue(existing),
        description: 'Booking request installment deleted',
      });
      return { deleted: true, installmentId };
    });
  }

  async allocatePayment(
    bookingRequestId: string,
    installmentId: string,
    propertyId: string,
    input: AllocateBookingRequestPaymentDto,
    actor?: AuditActor,
  ) {
    return this.db.transaction(async (tx: any) => {
      const request = await this.findRequest(tx, bookingRequestId, propertyId, true);
      this.assertNotDenied(request);
      const payment = await this.findParentPayment(
        tx,
        bookingRequestId,
        input.paymentId,
        propertyId,
        true,
      );
      const installment = await this.findInstallment(
        tx,
        bookingRequestId,
        installmentId,
        propertyId,
        true,
      );
      if (!['captured', 'settled', 'partially_refunded', 'refunded'].includes(payment.status)) {
        throw new ConflictException('Only captured payment movements can be allocated');
      }
      const amount = this.positiveMoney(input.amount, request.currencyCode, 'Allocation amount');
      const installmentAmount = this.resolvedInstallmentAmount(installment);
      const netCaptured = await this.netCapturedAmount(
        tx,
        bookingRequestId,
        propertyId,
        payment,
      );
      if (netCaptured.lte(0)) {
        throw new ConflictException('Fully returned payment movement cannot be allocated');
      }
      const allocations = await this.scopedAllocations(tx, bookingRequestId, propertyId);
      const paymentAllocated = allocations
        .filter((row) => row.paymentId === payment.id)
        .reduce((sum, row) => sum.plus(row.amount), new Decimal(0));
      const installmentAllocated = allocations
        .filter((row) => row.installmentId === installment.id)
        .reduce((sum, row) => sum.plus(row.amount), new Decimal(0));
      assertAllocationAmount({
        amount,
        movementAmount: netCaptured,
        installmentAmount,
        alreadyAllocatedMovementAmount: paymentAllocated,
        alreadyAllocatedInstallmentAmount: installmentAllocated,
      });

      const existing = allocations.find((row) =>
        row.paymentId === payment.id && row.installmentId === installment.id);
      let allocation: typeof bookingRequestPaymentAllocations.$inferSelect;
      if (existing) {
        const cumulative = new Decimal(existing.amount).plus(amount).toFixed(2);
        const candidates = await tx
          .update(bookingRequestPaymentAllocations)
          .set({ amount: cumulative })
          .where(and(
            eq(bookingRequestPaymentAllocations.id, existing.id),
            eq(bookingRequestPaymentAllocations.propertyId, propertyId),
            eq(bookingRequestPaymentAllocations.bookingRequestId, bookingRequestId),
          ))
          .returning();
        allocation = candidates.find((row: typeof bookingRequestPaymentAllocations.$inferSelect) =>
          row.id === existing.id) ?? { ...existing, amount: cumulative };
      } else {
        [allocation] = await tx
          .insert(bookingRequestPaymentAllocations)
          .values({
            propertyId,
            bookingRequestId,
            paymentId: payment.id,
            installmentId: installment.id,
            amount: amount.toFixed(2),
          })
          .returning();
      }

      const currentAllocations = await this.scopedAllocations(tx, bookingRequestId, propertyId);
      const allocated = currentAllocations
        .filter((row) => row.installmentId === installment.id)
        .reduce((sum, row) => sum.plus(row.amount), new Decimal(0));
      const resolved = new Decimal(installmentAmount);
      const status: InstallmentRow['status'] = allocated.eq(0)
        ? 'unpaid'
        : allocated.gte(resolved)
          ? 'paid'
          : 'partial';
      const installmentCandidates = await tx
        .update(bookingRequestInstallments)
        .set({
          allocatedAmount: allocated.toFixed(2),
          status,
          updatedAt: new Date(),
        })
        .where(and(
          eq(bookingRequestInstallments.id, installment.id),
          eq(bookingRequestInstallments.propertyId, propertyId),
          eq(bookingRequestInstallments.bookingRequestId, bookingRequestId),
        ))
        .returning();
      const updatedInstallment = installmentCandidates.find((row: InstallmentRow) =>
        row.id === installment.id) ?? {
        ...installment,
        allocatedAmount: allocated.toFixed(2),
        status,
      };
      await this.audit(tx, {
        propertyId,
        action: existing ? 'update' : 'create',
        entityType: 'booking_request_payment_allocation',
        entityId: allocation.id,
        actor,
        previousValue: existing ? { amount: existing.amount } : undefined,
        newValue: {
          requestId: bookingRequestId,
          paymentId: payment.id,
          installmentId: installment.id,
          amount: allocation.amount,
        },
        description: 'Booking request payment allocated to installment',
      });
      return { allocation, installment: updatedInstallment };
    });
  }

  async chargeSavedCard(
    bookingRequestId: string,
    propertyId: string,
    input: ChargeBookingRequestCardDto,
    actor?: AuditActor,
  ) {
    const idempotencyKey = this.scopedKey('charge', propertyId, input.idempotencyKey);
    const prepared = await this.db.transaction(async (tx: any) => {
      const request = await this.findRequest(tx, bookingRequestId, propertyId, true);
      this.assertNotDenied(request);
      const amount = this.positiveMoney(input.amount, request.currencyCode, 'Charge amount');
      if (this.requestTotal(request).lte(0)) {
        throw new ConflictException('A zero-total booking request cannot be charged');
      }
      if (!request.stripeCustomerId || !request.stripePaymentMethodId) {
        throw new ConflictException('The booking request has no saved payment method');
      }

      const [created] = await tx
        .insert(payments)
        .values({
          propertyId,
          bookingRequestId,
          folioId: request.acceptedFolioId,
          idempotencyKey,
          method: 'credit_card',
          status: 'pending',
          amount: amount.toFixed(2),
          currencyCode: request.currencyCode,
          gatewayProvider: 'stripe',
          gatewayPaymentToken: request.stripePaymentMethodId,
          cardLastFour: request.cardLastFour,
          cardBrand: request.cardBrand,
          notes: 'Staff-initiated Booking Request saved-card charge',
        })
        .onConflictDoNothing()
        .returning();
      if (!created) {
        let existing = await this.findPaymentByIdempotency(tx, propertyId, idempotencyKey);
        this.assertPaymentReplay(existing, {
          bookingRequestId,
          amount: amount.toFixed(2),
          currencyCode: request.currencyCode,
          method: 'credit_card',
        }, 'charge idempotency key');
        if (existing.status === 'captured') {
          const currentFolioId = request.acceptedFolioId ?? existing.folioId;
          if (currentFolioId && existing.folioId !== currentFolioId) {
            const candidates = await tx
              .update(payments)
              .set({ folioId: currentFolioId, updatedAt: new Date() })
              .where(and(
                eq(payments.id, existing.id),
                eq(payments.propertyId, propertyId),
                eq(payments.bookingRequestId, bookingRequestId),
              ))
              .returning();
            existing = candidates.find((row: PaymentRow) => row.id === existing.id) ?? {
              ...existing,
              folioId: currentFolioId,
            };
          }
          if (currentFolioId) {
            await this.folioService.recalculateBalance(currentFolioId, propertyId, tx);
          }
        }
        return { payment: existing, request, isNew: false };
      }
      await this.audit(tx, {
        propertyId,
        action: 'create',
        entityType: 'payment',
        entityId: created.id,
        actor,
        newValue: {
          requestId: bookingRequestId,
          folioId: request.acceptedFolioId,
          amount: created.amount,
          currencyCode: created.currencyCode,
          method: created.method,
          status: 'pending',
        },
        description: 'Booking request saved-card charge pending',
      });
      return { payment: created, request, isNew: true };
    });

    if (!prepared.isNew && prepared.payment.status !== 'pending') {
      return this.paymentResponse(prepared.payment);
    }

    let gatewayResult: Awaited<ReturnType<SavedPaymentMethodGateway['charge']>>;
    try {
      gatewayResult = await this.savedPaymentMethodGateway.charge({
        customerId: prepared.request.stripeCustomerId!,
        paymentMethodId: prepared.request.stripePaymentMethodId!,
        amount: prepared.payment.amount,
        currencyCode: prepared.payment.currencyCode,
        idempotencyKey,
      });
    } catch (error: unknown) {
      const safeMessage = error instanceof Error
        ? error.message.slice(0, 500)
        : 'Saved-card gateway result is unknown';
      await this.db.transaction(async (tx: any) => {
        const request = await this.findRequest(tx, bookingRequestId, propertyId, true);
        this.assertNotDenied(request);
        const existing = await this.findPayment(tx, prepared.payment.id, propertyId, true);
        if (existing.status !== 'pending') return;
        await tx
          .update(payments)
          .set({
            notes: `Gateway result unknown; retry with the same payment identity. ${safeMessage}`,
            updatedAt: new Date(),
          })
          .where(and(
            eq(payments.id, existing.id),
            eq(payments.propertyId, propertyId),
            eq(payments.bookingRequestId, bookingRequestId),
            eq(payments.status, 'pending'),
          ));
        await this.audit(tx, {
          propertyId,
          action: 'update',
          entityType: 'payment',
          entityId: existing.id,
          actor,
          previousValue: { status: 'pending' },
          newValue: { status: 'pending', result: 'unknown' },
          description: 'Booking request saved-card charge result unknown; retry required',
        });
      });
      throw new ServiceUnavailableException(
        'Saved-card gateway result is unknown; retry with the same idempotency key',
      );
    }

    const finalized = await this.db.transaction(async (tx: any) => {
      const request = await this.findRequest(tx, bookingRequestId, propertyId, true);
      this.assertNotDenied(request);
      const existing = await this.findPayment(tx, prepared.payment.id, propertyId, true);
      if (existing.status !== 'pending') return existing;
      const status: PaymentRow['status'] = gatewayResult.success ? 'captured' : 'failed';
      const changes = {
        status,
        folioId: request.acceptedFolioId,
        gatewayTransactionId: gatewayResult.transactionId || null,
        processedAt: gatewayResult.success ? new Date() : null,
        notes: gatewayResult.success
          ? 'Staff-initiated Booking Request saved-card charge captured'
          : gatewayResult.requiresAction
            ? 'Payment failed: additional authentication is required; no recovery link is available'
            : `Payment failed: ${gatewayResult.errorMessage ?? 'Gateway declined the charge'}`,
        updatedAt: new Date(),
      };
      const candidates = await tx
        .update(payments)
        .set(changes)
        .where(and(
          eq(payments.id, existing.id),
          eq(payments.propertyId, propertyId),
          eq(payments.bookingRequestId, bookingRequestId),
          eq(payments.status, 'pending'),
        ))
        .returning();
      const updated = candidates.find((row: PaymentRow) => row.id === existing.id) ?? {
        ...existing,
        ...changes,
      };
      await this.audit(tx, {
        propertyId,
        action: 'update',
        entityType: 'payment',
        entityId: updated.id,
        actor,
        previousValue: { status: 'pending' },
        newValue: {
          requestId: bookingRequestId,
          folioId: updated.folioId,
          amount: updated.amount,
          currencyCode: updated.currencyCode,
          status,
          requiresAction: gatewayResult.requiresAction,
        },
        description: status === 'captured'
          ? 'Booking request payment captured'
          : 'Booking request payment failed',
      });
      if (status === 'captured' && updated.folioId) {
        await this.folioService.recalculateBalance(updated.folioId, propertyId, tx);
      }
      return updated;
    });
    return this.paymentResponse(finalized);
  }

  async recordExternalPayment(
    bookingRequestId: string,
    propertyId: string,
    input: RecordBookingRequestExternalPaymentDto,
    actor?: AuditActor,
  ) {
    const reference = input.reference.trim();
    if (!reference) throw new BadRequestException('An external payment reference is required');
    const provider = input.provider?.trim() || 'external';
    const idempotencyKey = this.scopedKey('external', propertyId, reference);
    const result = await this.db.transaction(async (tx: any) => {
      const request = await this.findRequest(tx, bookingRequestId, propertyId, true);
      this.assertNotDenied(request);
      if (this.requestTotal(request).lte(0)) {
        throw new ConflictException('A zero-total booking request cannot receive payments');
      }
      const currencyCode = input.currencyCode.trim().toUpperCase();
      if (currencyCode !== request.currencyCode.toUpperCase()) {
        throw new ConflictException(
          `External payment currency ${currencyCode} does not match request currency ${request.currencyCode}`,
        );
      }
      if (!EXTERNAL_PAYMENT_METHODS.has(input.method)) {
        throw new BadRequestException(`Unsupported external payment method '${input.method}'`);
      }
      const amount = this.positiveMoney(input.amount, currencyCode, 'External payment amount');
      const processedAt = this.processedDate(input.processedAt, 'External payment');
      const [created] = await tx
        .insert(payments)
        .values({
          propertyId,
          bookingRequestId,
          folioId: request.acceptedFolioId,
          idempotencyKey,
          method: input.method,
          status: 'captured',
          amount: amount.toFixed(2),
          currencyCode,
          gatewayProvider: provider,
          gatewayTransactionId: reference,
          notes: input.notes?.trim() || null,
          processedAt,
        })
        .onConflictDoNothing()
        .returning();
      if (!created) {
        const existing = await this.findPaymentByIdempotency(tx, propertyId, idempotencyKey);
        this.assertPaymentReplay(existing, {
          bookingRequestId,
          amount: amount.toFixed(2),
          currencyCode,
          method: input.method,
          reference,
          provider,
          processedAt,
          notes: input.notes?.trim() || null,
          operationPrefix: 'booking-request-external:',
        }, 'external payment reference');
        if (existing.folioId) {
          await this.folioService.recalculateBalance(existing.folioId, propertyId, tx);
        }
        return { payment: existing, isNew: false };
      }
      await this.audit(tx, {
        propertyId,
        action: 'create',
        entityType: 'payment',
        entityId: created.id,
        actor,
        newValue: {
          requestId: bookingRequestId,
          folioId: created.folioId,
          amount: created.amount,
          currencyCode,
          method: created.method,
          provider,
          reference,
          processedAt: processedAt.toISOString(),
          status: 'captured',
        },
        description: 'External booking request payment recorded',
      });
      if (created.folioId) {
        await this.folioService.recalculateBalance(created.folioId, propertyId, tx);
      }
      return { payment: created, isNew: true };
    });
    return this.paymentResponse(result.payment);
  }

  async refund(
    bookingRequestId: string,
    paymentId: string,
    propertyId: string,
    input: RefundBookingRequestPaymentDto,
    actor?: AuditActor,
  ) {
    const idempotencyKey = this.scopedKey('refund', propertyId, input.idempotencyKey);
    const prepared = await this.db.transaction(async (tx: any) => {
      const request = await this.findRequest(tx, bookingRequestId, propertyId, true);
      this.assertNotDenied(request);
      const original = await this.findParentPayment(
        tx,
        bookingRequestId,
        paymentId,
        propertyId,
        true,
      );
      if (!original.idempotencyKey?.startsWith('booking-request-charge:')) {
        throw new ConflictException(
          'Externally recorded payments must use the external return operation',
        );
      }
      if (!original.gatewayTransactionId || original.method !== 'credit_card') {
        throw new ConflictException('Only a captured gateway card payment can be refunded');
      }
      const amount = this.positiveMoney(input.amount, original.currencyCode, 'Refund amount');
      const fingerprint = this.operationFingerprint({
        operation: 'refund',
        propertyId,
        bookingRequestId,
        paymentId,
        amount: amount.toFixed(2),
        currencyCode: original.currencyCode.toUpperCase(),
        gatewayTransactionId: original.gatewayTransactionId,
      });
      const replay = await this.findResolutionByIdempotency(
        tx,
        propertyId,
        idempotencyKey,
      );
      if (replay) {
        this.assertResolutionReplay(replay, fingerprint, 'Refund idempotency key');
        if (replay.status === 'completed' && replay.movementId) {
          const movement = await this.findPayment(tx, replay.movementId, propertyId, true);
          if (movement.folioId) {
            await this.folioService.recalculateBalance(movement.folioId, propertyId, tx);
          }
          return { request, original, amount, claim: replay, movement, terminal: true as const };
        }
        if (replay.status === 'failed') {
          throw new ConflictException(replay.lastError ?? 'Refund was declined by the gateway');
        }
        return { request, original, amount, claim: replay, terminal: false as const };
      }

      await this.assertResolutionCapacity(tx, bookingRequestId, propertyId, original, amount);
      const [claim] = await tx
        .insert(bookingRequestPaymentResolutions)
        .values({
          propertyId,
          bookingRequestId,
          paymentId,
          type: 'refund',
          status: 'pending',
          amount: amount.toFixed(2),
          idempotencyKey,
          operationFingerprint: fingerprint,
          reason: 'Gateway refund pending',
          resolvedBy: actor?.userId ?? null,
          resolvedAt: null,
        })
        .returning();
      await this.audit(tx, {
        propertyId,
        action: 'create',
        entityType: 'booking_request_payment_resolution',
        entityId: claim.id,
        actor,
        newValue: {
          requestId: bookingRequestId,
          paymentId,
          type: 'refund',
          status: 'pending',
          amount: amount.toFixed(2),
        },
        description: 'Booking request gateway refund capacity claimed',
      });
      return { request, original, amount, claim, terminal: false as const };
    });
    if (prepared.terminal) {
      return {
        movement: this.paymentResponse(prepared.movement),
        resolution: prepared.claim,
      };
    }

    let gatewayResult: PaymentGatewayResult;
    try {
      gatewayResult = await this.paymentGateway.refund(
        prepared.original.gatewayTransactionId!,
        prepared.amount.toNumber(),
        { idempotencyKey, currencyCode: prepared.original.currencyCode },
      );
    } catch (error: unknown) {
      await this.recordUnknownResolutionAttempt({
        bookingRequestId,
        propertyId,
        paymentId,
        resolutionId: prepared.claim.id,
        error,
        actor,
      });
      throw new ServiceUnavailableException(
        'Gateway refund result is unknown; retry with the same idempotency key',
      );
    }

    if (!gatewayResult.success) {
      await this.finalizeFailedRefundClaim({
        bookingRequestId,
        propertyId,
        paymentId,
        resolutionId: prepared.claim.id,
        errorMessage: gatewayResult.errorMessage ?? 'Gateway declined the refund',
        actor,
      });
      throw new ConflictException(`Refund failed: ${gatewayResult.errorMessage ?? 'Gateway declined'}`);
    }

    return this.finalizeCapturedRefund({
      bookingRequestId,
      propertyId,
      paymentId,
      resolutionId: prepared.claim.id,
      idempotencyKey,
      gatewayResult,
      actor,
    });
  }

  async recordExternalReturn(
    bookingRequestId: string,
    paymentId: string,
    propertyId: string,
    input: RecordBookingRequestExternalReturnDto,
    actor?: AuditActor,
  ) {
    const processedAt = this.processedDate(input.processedAt, 'External return');
    const reference = input.reference.trim();
    if (!reference) throw new BadRequestException('An external return reference is required');
    const idempotencyKey = this.scopedKey('external-return', propertyId, reference);
    const result = await this.db.transaction(async (tx: any) => {
      const request = await this.findRequest(tx, bookingRequestId, propertyId, true);
      this.assertNotDenied(request);
      const original = await this.findParentPayment(
        tx,
        bookingRequestId,
        paymentId,
        propertyId,
        true,
      );
      if (!original.idempotencyKey?.startsWith('booking-request-external:')) {
        throw new ConflictException('Gateway payments must use the refund operation');
      }
      const amount = this.positiveMoney(input.amount, original.currencyCode, 'External return amount');
      const existing = await this.findOptionalPaymentByIdempotency(tx, propertyId, idempotencyKey);
      if (existing) {
        const notes = input.notes?.trim() || `External return of payment ${original.id}`;
        this.assertPaymentReplay(existing, {
          bookingRequestId,
          amount: amount.negated().toFixed(2),
          currencyCode: original.currencyCode,
          method: original.method,
          reference,
          originalPaymentId: original.id,
          provider: original.gatewayProvider,
          processedAt,
          notes,
          operationPrefix: 'booking-request-external-return:',
        }, 'external return reference');
        const resolution = await this.ensureResolution(tx, {
          bookingRequestId,
          propertyId,
          paymentId,
          type: 'external_return',
          amount: amount.toFixed(2),
          reason: `External return movement ${existing.id}`,
          actor,
          marker: existing.id,
        });
        if (existing.folioId) {
          await this.folioService.recalculateBalance(existing.folioId, propertyId, tx);
        }
        return { movement: existing, resolution, isNew: false };
      }
      await this.assertResolutionCapacity(
        tx,
        bookingRequestId,
        propertyId,
        original,
        amount,
      );
      const [movement] = await tx
        .insert(payments)
        .values({
          propertyId,
          bookingRequestId,
          folioId: request.acceptedFolioId,
          idempotencyKey,
          method: original.method,
          status: 'captured',
          amount: amount.negated().toFixed(2),
          currencyCode: original.currencyCode,
          gatewayProvider: original.gatewayProvider,
          gatewayTransactionId: reference,
          originalPaymentId: original.id,
          notes: input.notes?.trim() || `External return of payment ${original.id}`,
          processedAt,
        })
        .returning();
      const resolution = await this.ensureResolution(tx, {
        bookingRequestId,
        propertyId,
        paymentId,
        type: 'external_return',
        amount: amount.toFixed(2),
        reason: `External return movement ${movement.id}`,
        actor,
        marker: movement.id,
      });
      await this.audit(tx, {
        propertyId,
        action: 'create',
        entityType: 'payment',
        entityId: movement.id,
        actor,
        newValue: {
          requestId: bookingRequestId,
          folioId: movement.folioId,
          originalPaymentId: original.id,
          amount: movement.amount,
          currencyCode: movement.currencyCode,
          type: 'external_return',
          reference,
        },
        description: 'External booking request payment return recorded',
      });
      await this.reconcileAllocationsForPayment(
        tx,
        bookingRequestId,
        propertyId,
        original,
        actor,
      );
      if (movement.folioId) {
        await this.folioService.recalculateBalance(movement.folioId, propertyId, tx);
      }
      return { movement, resolution, isNew: true };
    });
    return {
      movement: this.paymentResponse(result.movement),
      resolution: result.resolution,
    };
  }

  async retainForDenial(
    bookingRequestId: string,
    paymentId: string,
    propertyId: string,
    input: RetainBookingRequestPaymentDto,
    actor?: AuditActor,
  ) {
    const reason = input.reason?.trim();
    if (!reason) throw new BadRequestException('A reason is required for retained money');
    return this.db.transaction(async (tx: any) => {
      const request = await this.findRequest(tx, bookingRequestId, propertyId, true);
      if (request.status !== 'pending') {
        throw new ConflictException('Money may be retained only for a pending request');
      }
      const original = await this.findParentPayment(
        tx,
        bookingRequestId,
        paymentId,
        propertyId,
        true,
      );
      const amount = this.positiveMoney(input.amount, original.currencyCode, 'Retained amount');
      const existing = (await this.scopedResolutions(tx, bookingRequestId, propertyId))
        .find((row) =>
          row.paymentId === paymentId
          && row.type === 'retained'
          && new Decimal(row.amount).eq(amount)
          && row.reason?.trim() === reason);
      if (existing) return existing;
      await this.assertResolutionCapacity(
        tx,
        bookingRequestId,
        propertyId,
        original,
        amount,
      );
      return this.ensureResolution(tx, {
        bookingRequestId,
        propertyId,
        paymentId,
        type: 'retained',
        amount: amount.toFixed(2),
        reason,
        actor,
      });
    });
  }

  private operationFingerprint(value: Record<string, unknown>): string {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
  }

  private async findResolutionByIdempotency(
    db: any,
    propertyId: string,
    idempotencyKey: string,
  ): Promise<ResolutionRow | undefined> {
    const rows = await db
      .select()
      .from(bookingRequestPaymentResolutions)
      .where(and(
        eq(bookingRequestPaymentResolutions.propertyId, propertyId),
        eq(bookingRequestPaymentResolutions.idempotencyKey, idempotencyKey),
      ));
    return rows.find((row: ResolutionRow) =>
      row.propertyId === propertyId && row.idempotencyKey === idempotencyKey);
  }

  private async findResolution(
    db: any,
    bookingRequestId: string,
    paymentId: string,
    resolutionId: string,
    propertyId: string,
    lock = false,
  ): Promise<ResolutionRow> {
    const query = db
      .select()
      .from(bookingRequestPaymentResolutions)
      .where(and(
        eq(bookingRequestPaymentResolutions.id, resolutionId),
        eq(bookingRequestPaymentResolutions.propertyId, propertyId),
        eq(bookingRequestPaymentResolutions.bookingRequestId, bookingRequestId),
        eq(bookingRequestPaymentResolutions.paymentId, paymentId),
      ));
    const rows = lock ? await query.for('update') : await query;
    const resolution = rows.find((row: ResolutionRow) =>
      row.id === resolutionId
      && row.propertyId === propertyId
      && row.bookingRequestId === bookingRequestId
      && row.paymentId === paymentId);
    if (!resolution) throw new NotFoundException(`Payment resolution ${resolutionId} not found`);
    return resolution;
  }

  private assertResolutionReplay(
    resolution: ResolutionRow,
    expectedFingerprint: string,
    label: string,
  ): void {
    if (resolution.operationFingerprint !== expectedFingerprint) {
      throw new ConflictException(`${label} was already used for different financial data`);
    }
  }

  private async recordUnknownResolutionAttempt(input: {
    bookingRequestId: string;
    propertyId: string;
    paymentId: string;
    resolutionId: string;
    error: unknown;
    actor?: AuditActor;
  }): Promise<void> {
    await this.db.transaction(async (tx: any) => {
      const request = await this.findRequest(
        tx,
        input.bookingRequestId,
        input.propertyId,
        true,
      );
      this.assertNotDenied(request);
      await this.findParentPayment(
        tx,
        input.bookingRequestId,
        input.paymentId,
        input.propertyId,
        true,
      );
      const claim = await this.findResolution(
        tx,
        input.bookingRequestId,
        input.paymentId,
        input.resolutionId,
        input.propertyId,
        true,
      );
      if (claim.status !== 'pending') return;
      const lastError = input.error instanceof Error
        ? input.error.message.slice(0, 500)
        : 'Gateway result unknown';
      await tx
        .update(bookingRequestPaymentResolutions)
        .set({
          attempts: (claim.attempts ?? 0) + 1,
          lastError,
          updatedAt: new Date(),
        })
        .where(and(
          eq(bookingRequestPaymentResolutions.id, claim.id),
          eq(bookingRequestPaymentResolutions.propertyId, input.propertyId),
          eq(bookingRequestPaymentResolutions.status, 'pending'),
        ));
      await this.audit(tx, {
        propertyId: input.propertyId,
        action: 'update',
        entityType: 'booking_request_payment_resolution',
        entityId: claim.id,
        actor: input.actor,
        previousValue: { status: 'pending' },
        newValue: { status: 'pending', result: 'unknown' },
        description: 'Booking request refund result unknown; retry required',
      });
    });
  }

  private async finalizeFailedRefundClaim(input: {
    bookingRequestId: string;
    propertyId: string;
    paymentId: string;
    resolutionId: string;
    errorMessage: string;
    actor?: AuditActor;
  }): Promise<void> {
    await this.db.transaction(async (tx: any) => {
      const request = await this.findRequest(
        tx,
        input.bookingRequestId,
        input.propertyId,
        true,
      );
      this.assertNotDenied(request);
      await this.findParentPayment(
        tx,
        input.bookingRequestId,
        input.paymentId,
        input.propertyId,
        true,
      );
      const claim = await this.findResolution(
        tx,
        input.bookingRequestId,
        input.paymentId,
        input.resolutionId,
        input.propertyId,
        true,
      );
      if (claim.status !== 'pending') return;
      await tx
        .update(bookingRequestPaymentResolutions)
        .set({
          status: 'failed',
          attempts: (claim.attempts ?? 0) + 1,
          lastError: input.errorMessage.slice(0, 500),
          resolvedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(and(
          eq(bookingRequestPaymentResolutions.id, claim.id),
          eq(bookingRequestPaymentResolutions.propertyId, input.propertyId),
          eq(bookingRequestPaymentResolutions.status, 'pending'),
        ));
      await this.audit(tx, {
        propertyId: input.propertyId,
        action: 'update',
        entityType: 'booking_request_payment_resolution',
        entityId: claim.id,
        actor: input.actor,
        previousValue: { status: 'pending' },
        newValue: { status: 'failed', error: input.errorMessage.slice(0, 500) },
        description: 'Booking request gateway refund failed',
      });
    });
  }

  private async finalizeCapturedRefund(input: {
    bookingRequestId: string;
    propertyId: string;
    paymentId: string;
    resolutionId: string;
    idempotencyKey: string;
    gatewayResult: PaymentGatewayResult;
    actor?: AuditActor;
  }) {
    return this.db.transaction(async (tx: any) => {
      const request = await this.findRequest(
        tx,
        input.bookingRequestId,
        input.propertyId,
        true,
      );
      this.assertNotDenied(request);
      const original = await this.findParentPayment(
        tx,
        input.bookingRequestId,
        input.paymentId,
        input.propertyId,
        true,
      );
      const claim = await this.findResolution(
        tx,
        input.bookingRequestId,
        input.paymentId,
        input.resolutionId,
        input.propertyId,
        true,
      );
      if (claim.status === 'completed' && claim.movementId) {
        const movement = await this.findPayment(tx, claim.movementId, input.propertyId, true);
        if (movement.folioId) {
          await this.folioService.recalculateBalance(movement.folioId, input.propertyId, tx);
        }
        return { movement: this.paymentResponse(movement), resolution: claim };
      }
      if (claim.status !== 'pending') {
        throw new ConflictException(`Refund claim is '${claim.status}' and cannot be finalized`);
      }

      const [movement] = await tx
        .insert(payments)
        .values({
          propertyId: input.propertyId,
          bookingRequestId: input.bookingRequestId,
          folioId: request.acceptedFolioId,
          idempotencyKey: input.idempotencyKey,
          method: original.method,
          status: 'captured',
          amount: new Decimal(claim.amount).negated().toFixed(2),
          currencyCode: original.currencyCode,
          gatewayProvider: original.gatewayProvider,
          gatewayTransactionId: input.gatewayResult.transactionId,
          originalPaymentId: original.id,
          notes: `Refund of Booking Request payment ${original.id}`,
          processedAt: new Date(),
        })
        .returning();
      const resolvedAt = new Date();
      const candidates = await tx
        .update(bookingRequestPaymentResolutions)
        .set({
          status: 'completed',
          movementId: movement.id,
          reason: `Gateway refund movement ${movement.id}`,
          attempts: (claim.attempts ?? 0) + 1,
          lastError: null,
          resolvedAt,
          updatedAt: resolvedAt,
        })
        .where(and(
          eq(bookingRequestPaymentResolutions.id, claim.id),
          eq(bookingRequestPaymentResolutions.propertyId, input.propertyId),
          eq(bookingRequestPaymentResolutions.status, 'pending'),
        ))
        .returning();
      const resolution = candidates.find((row: ResolutionRow) => row.id === claim.id) ?? {
        ...claim,
        status: 'completed' as const,
        movementId: movement.id,
        reason: `Gateway refund movement ${movement.id}`,
        attempts: (claim.attempts ?? 0) + 1,
        lastError: null,
        resolvedAt,
        updatedAt: resolvedAt,
      };
      await this.audit(tx, {
        propertyId: input.propertyId,
        action: 'create',
        entityType: 'payment',
        entityId: movement.id,
        actor: input.actor,
        newValue: {
          requestId: input.bookingRequestId,
          folioId: movement.folioId,
          originalPaymentId: original.id,
          amount: movement.amount,
          currencyCode: movement.currencyCode,
          type: 'refund',
        },
        description: 'Booking request gateway refund movement captured',
      });
      await this.audit(tx, {
        propertyId: input.propertyId,
        action: 'update',
        entityType: 'booking_request_payment_resolution',
        entityId: claim.id,
        actor: input.actor,
        previousValue: { status: 'pending' },
        newValue: {
          status: 'completed',
          movementId: movement.id,
          amount: claim.amount,
        },
        description: 'Booking request gateway refund completed',
      });
      await this.reconcileAllocationsForPayment(
        tx,
        input.bookingRequestId,
        input.propertyId,
        original,
        input.actor,
      );
      if (movement.folioId) {
        await this.folioService.recalculateBalance(movement.folioId, input.propertyId, tx);
      }
      return { movement: this.paymentResponse(movement), resolution };
    });
  }

  private normalizeInstallment(
    request: RequestRow,
    input: CreateBookingRequestInstallmentDto,
  ) {
    const label = input.label?.trim();
    if (!label) throw new BadRequestException('An installment label is required');
    const dueMilestone = input.dueMilestone as InstallmentMilestone;
    if (!['date', 'arrival', 'checkout', 'manual'].includes(dueMilestone)) {
      throw new BadRequestException(`Unsupported installment milestone '${dueMilestone}'`);
    }
    if (dueMilestone === 'date' && !input.dueDate) {
      throw new BadRequestException('A due date is required for the date milestone');
    }
    if (dueMilestone !== 'date' && input.dueDate) {
      throw new BadRequestException('A due date is valid only for the date milestone');
    }
    const percentage = input.percentage == null
      ? undefined
      : this.positivePercentage(input.percentage);
    const fixedAmount = input.fixedAmount == null
      ? undefined
      : this.positiveMoney(input.fixedAmount, request.currencyCode, 'Fixed installment amount');
    const resolved = resolveInstallmentAmount({
      total: this.requestTotal(request),
      fixedAmount,
      percentage,
      currencyExponent: this.currencyExponent(request.currencyCode),
    });
    return {
      label,
      sortOrder: input.sortOrder ?? 0,
      fixedAmount: fixedAmount?.toFixed(2) ?? null,
      percentage: percentage?.toFixed(2) ?? null,
      resolvedAmount: resolved.toFixed(2),
      dueMilestone,
      dueDate: dueMilestone === 'date' ? input.dueDate! : null,
    };
  }

  private positivePercentage(value: string): Decimal {
    const amount = this.decimal(value, 'Installment percentage');
    if (amount.lte(0)) throw new ConflictException('Installment percentage must be positive');
    if (amount.decimalPlaces() > 2) {
      throw new BadRequestException('Installment percentage supports at most two decimal places');
    }
    if (amount.gte(1000)) {
      throw new BadRequestException('Installment percentage exceeds storage precision');
    }
    return amount;
  }

  private positiveMoney(value: string, currencyCode: string, field: string): Decimal {
    const amount = this.decimal(value, field);
    if (amount.lte(0)) throw new ConflictException(`${field} must be positive`);
    const exponent = this.currencyExponent(currencyCode);
    if (exponent > 2) {
      throw new BadRequestException(
        `${currencyCode.toUpperCase()} minor-unit exponent ${exponent} exceeds ledger storage precision`,
      );
    }
    if (amount.decimalPlaces() > exponent) {
      throw new BadRequestException(
        `${field} has fractional minor units for ${currencyCode.toUpperCase()}`,
      );
    }
    if (amount.decimalPlaces() > 2) {
      throw new BadRequestException(`${field} exceeds ledger storage precision`);
    }
    return amount;
  }

  private decimal(value: string, field: string): Decimal {
    try {
      const amount = new Decimal(value);
      if (!amount.isFinite()) throw new Error('not finite');
      return amount;
    } catch {
      throw new BadRequestException(`Invalid ${field}`);
    }
  }

  private currencyExponent(currencyCode: string): number {
    try {
      const exponent = new Intl.NumberFormat('en', {
        style: 'currency',
        currency: currencyCode.trim().toUpperCase(),
      }).resolvedOptions().maximumFractionDigits;
      if (exponent == null) throw new Error('missing exponent');
      return exponent;
    } catch {
      throw new BadRequestException(`Unsupported currency '${currencyCode}'`);
    }
  }

  private requestTotal(request: RequestRow): Decimal {
    const submitted = request.submittedQuoteSnapshot as Record<string, unknown> | null;
    const raw = request.status === 'accepted'
      ? request.acceptedTotal
      : submitted?.['grandTotal'];
    if (typeof raw !== 'string') {
      throw new ConflictException('Booking request has no authoritative total');
    }
    const total = this.decimal(raw, 'booking request total');
    if (total.lt(0)) throw new ConflictException('Booking request total cannot be negative');
    return total;
  }

  private processedDate(value: string, label: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new BadRequestException(`${label} date is invalid`);
    if (date.getTime() > Date.now()) {
      throw new BadRequestException(`${label} processed date cannot be in the future`);
    }
    return date;
  }

  private scopedKey(kind: string, propertyId: string, clientIdentity: string): string {
    const normalized = clientIdentity.trim();
    if (!normalized) throw new BadRequestException(`${kind} idempotency identity is required`);
    const digest = createHash('sha256')
      .update(`${propertyId}:${normalized}`)
      .digest('hex');
    return `booking-request-${kind}:${digest}`;
  }

  private assertNotDenied(request: RequestRow): void {
    if (request.status === 'denied') {
      throw new ConflictException('Cannot move money on a denied booking request');
    }
  }

  private async findRequest(
    db: any,
    bookingRequestId: string,
    propertyId: string,
    lock = false,
  ): Promise<RequestRow> {
    const query = db
      .select()
      .from(bookingRequests)
      .where(and(
        eq(bookingRequests.id, bookingRequestId),
        eq(bookingRequests.propertyId, propertyId),
      ));
    const rows = lock ? await query.for('update') : await query;
    const request = rows.find((row: RequestRow) =>
      row.id === bookingRequestId && row.propertyId === propertyId);
    if (!request) throw new NotFoundException(`Booking request ${bookingRequestId} not found`);
    return request;
  }

  private async findInstallment(
    db: any,
    bookingRequestId: string,
    installmentId: string,
    propertyId: string,
    lock = false,
  ): Promise<InstallmentRow> {
    const query = db
      .select()
      .from(bookingRequestInstallments)
      .where(and(
        eq(bookingRequestInstallments.id, installmentId),
        eq(bookingRequestInstallments.bookingRequestId, bookingRequestId),
        eq(bookingRequestInstallments.propertyId, propertyId),
      ));
    const rows = lock ? await query.for('update') : await query;
    const installment = rows.find((row: InstallmentRow) =>
      row.id === installmentId
      && row.bookingRequestId === bookingRequestId
      && row.propertyId === propertyId);
    if (!installment) throw new NotFoundException(`Installment ${installmentId} not found`);
    return installment;
  }

  private async findParentPayment(
    db: any,
    bookingRequestId: string,
    paymentId: string,
    propertyId: string,
    lock = false,
  ): Promise<PaymentRow> {
    const payment = await this.findPayment(db, paymentId, propertyId, lock);
    if (payment.bookingRequestId !== bookingRequestId || payment.originalPaymentId != null) {
      throw new NotFoundException(`Payment ${paymentId} not found`);
    }
    if (!['captured', 'settled', 'partially_refunded', 'refunded'].includes(payment.status)) {
      throw new ConflictException('Payment is not a captured movement');
    }
    if (new Decimal(payment.amount).lte(0)) {
      throw new ConflictException('Captured payment amount must be positive');
    }
    return payment;
  }

  private async findPayment(
    db: any,
    paymentId: string,
    propertyId: string,
    lock = false,
  ): Promise<PaymentRow> {
    const query = db
      .select()
      .from(payments)
      .where(and(eq(payments.id, paymentId), eq(payments.propertyId, propertyId)));
    const rows = lock ? await query.for('update') : await query;
    const payment = rows.find((row: PaymentRow) =>
      row.id === paymentId && row.propertyId === propertyId);
    if (!payment) throw new NotFoundException(`Payment ${paymentId} not found`);
    return payment;
  }

  private async findOptionalPaymentByIdempotency(
    db: any,
    propertyId: string,
    idempotencyKey: string,
  ): Promise<PaymentRow | undefined> {
    const rows = await db
      .select()
      .from(payments)
      .where(and(
        eq(payments.propertyId, propertyId),
        eq(payments.idempotencyKey, idempotencyKey),
      ));
    return rows.find((row: PaymentRow) =>
      row.propertyId === propertyId && row.idempotencyKey === idempotencyKey);
  }

  private async findPaymentByIdempotency(
    db: any,
    propertyId: string,
    idempotencyKey: string,
  ): Promise<PaymentRow> {
    const payment = await this.findOptionalPaymentByIdempotency(
      db,
      propertyId,
      idempotencyKey,
    );
    if (!payment) throw new ConflictException('Idempotent payment could not be recovered');
    return payment;
  }

  private assertPaymentReplay(
    existing: PaymentRow,
    expected: {
      bookingRequestId: string;
      amount: string;
      currencyCode: string;
      method: string;
      reference?: string;
      originalPaymentId?: string;
      provider?: string | null;
      processedAt?: Date;
      notes?: string | null;
      operationPrefix?: string;
    },
    identityLabel: string,
  ): void {
    if (
      existing.bookingRequestId !== expected.bookingRequestId
      || !new Decimal(existing.amount).eq(expected.amount)
      || existing.currencyCode.toUpperCase() !== expected.currencyCode.toUpperCase()
      || existing.method !== expected.method
      || (expected.reference != null && existing.gatewayTransactionId !== expected.reference)
      || (expected.provider !== undefined && existing.gatewayProvider !== expected.provider)
      || (
        expected.processedAt != null
        && existing.processedAt?.getTime() !== expected.processedAt.getTime()
      )
      || (expected.notes !== undefined && existing.notes !== expected.notes)
      || (
        expected.operationPrefix != null
        && !existing.idempotencyKey?.startsWith(expected.operationPrefix)
      )
      || (
        expected.originalPaymentId != null
        && existing.originalPaymentId !== expected.originalPaymentId
      )
    ) {
      throw new ConflictException(`${identityLabel} was already used for different payment data`);
    }
  }

  private async scopedAllocations(
    db: any,
    bookingRequestId: string,
    propertyId: string,
  ): Promise<AllocationRow[]> {
    const rows = await db
      .select()
      .from(bookingRequestPaymentAllocations)
      .where(and(
        eq(bookingRequestPaymentAllocations.bookingRequestId, bookingRequestId),
        eq(bookingRequestPaymentAllocations.propertyId, propertyId),
      ));
    return rows.filter((row: AllocationRow) =>
      row.bookingRequestId === bookingRequestId && row.propertyId === propertyId);
  }

  private async netCapturedAmount(
    db: any,
    bookingRequestId: string,
    propertyId: string,
    payment: PaymentRow,
  ): Promise<Decimal> {
    const rows = await db
      .select()
      .from(payments)
      .where(and(
        eq(payments.originalPaymentId, payment.id),
        eq(payments.bookingRequestId, bookingRequestId),
        eq(payments.propertyId, propertyId),
        eq(payments.status, 'captured'),
      ));
    const children = rows.filter((row: PaymentRow) =>
      row.originalPaymentId === payment.id
      && row.bookingRequestId === bookingRequestId
      && row.propertyId === propertyId
      && row.status === 'captured');
    return remainingCapturedAmount(payment.amount, children);
  }

  private async reconcileAllocationsForPayment(
    tx: any,
    bookingRequestId: string,
    propertyId: string,
    payment: PaymentRow,
    actor?: AuditActor,
  ): Promise<void> {
    await reconcileBookingRequestPaymentAllocations(tx, {
      bookingRequestId,
      propertyId,
      payment,
      actor,
    });
  }

  private async scopedResolutions(
    db: any,
    bookingRequestId: string,
    propertyId: string,
  ): Promise<ResolutionRow[]> {
    const rows = await db
      .select()
      .from(bookingRequestPaymentResolutions)
      .where(and(
        eq(bookingRequestPaymentResolutions.bookingRequestId, bookingRequestId),
        eq(bookingRequestPaymentResolutions.propertyId, propertyId),
      ));
    return rows.filter((row: ResolutionRow) =>
      row.bookingRequestId === bookingRequestId && row.propertyId === propertyId);
  }

  private async installmentAllocationTotal(
    db: any,
    bookingRequestId: string,
    installmentId: string,
    propertyId: string,
  ): Promise<Decimal> {
    return (await this.scopedAllocations(db, bookingRequestId, propertyId))
      .filter((row) => row.installmentId === installmentId)
      .reduce((sum, row) => sum.plus(row.amount), new Decimal(0));
  }

  private resolvedInstallmentAmount(installment: InstallmentRow): string {
    if (installment.resolvedAmount == null) {
      throw new ConflictException(`Installment ${installment.id} has no resolved amount`);
    }
    return installment.resolvedAmount;
  }

  private async assertResolutionCapacity(
    db: any,
    bookingRequestId: string,
    propertyId: string,
    payment: PaymentRow,
    amount: Decimal,
  ): Promise<void> {
    const resolutions = await this.scopedResolutions(db, bookingRequestId, propertyId);
    const resolved = resolutions
      .filter((row) =>
        row.paymentId === payment.id
        && (row.status == null || row.status === 'pending' || row.status === 'completed'))
      .reduce((sum, row) => sum.plus(row.amount), new Decimal(0));
    const remaining = new Decimal(payment.amount).minus(resolved);
    if (amount.gt(remaining)) {
      throw new ConflictException(
        `Resolution amount ${amount.toFixed(2)} exceeds remaining captured amount ${remaining.toFixed(2)}`,
      );
    }
  }

  private async recordResolution(input: {
    bookingRequestId: string;
    propertyId: string;
    paymentId: string;
    type: ResolutionRow['type'];
    amount: string;
    reason: string;
    actor?: AuditActor;
    marker?: string;
  }) {
    return this.db.transaction(async (tx: any) => {
      await this.findRequest(tx, input.bookingRequestId, input.propertyId, true);
      const original = await this.findParentPayment(
        tx,
        input.bookingRequestId,
        input.paymentId,
        input.propertyId,
        true,
      );
      const existing = (await this.scopedResolutions(
        tx,
        input.bookingRequestId,
        input.propertyId,
      )).find((row) =>
        row.paymentId === input.paymentId
        && row.type === input.type
        && input.marker != null
        && row.reason?.includes(input.marker));
      if (existing) return existing;
      await this.assertResolutionCapacity(
        tx,
        input.bookingRequestId,
        input.propertyId,
        original,
        new Decimal(input.amount),
      );
      return this.ensureResolution(tx, input);
    });
  }

  private async ensureResolution(
    tx: any,
    input: {
      bookingRequestId: string;
      propertyId: string;
      paymentId: string;
      type: ResolutionRow['type'];
      amount: string;
      reason?: string;
      actor?: AuditActor;
      marker?: string;
    },
  ) {
    if (input.marker) {
      const existing = (await this.scopedResolutions(
        tx,
        input.bookingRequestId,
        input.propertyId,
      )).find((row) =>
        row.paymentId === input.paymentId
        && row.type === input.type
        && row.reason?.includes(input.marker!));
      if (existing) return existing;
    }
    const [resolution] = await tx
      .insert(bookingRequestPaymentResolutions)
      .values({
        propertyId: input.propertyId,
        bookingRequestId: input.bookingRequestId,
        paymentId: input.paymentId,
        type: input.type,
        amount: input.amount,
        reason: input.reason ?? null,
        resolvedBy: input.actor?.userId ?? null,
        resolvedAt: new Date(),
      })
      .returning();
    await this.audit(tx, {
      propertyId: input.propertyId,
      action: 'create',
      entityType: 'booking_request_payment_resolution',
      entityId: resolution.id,
      actor: input.actor,
      newValue: {
        requestId: input.bookingRequestId,
        paymentId: input.paymentId,
        type: input.type,
        amount: input.amount,
        reason: input.reason ?? null,
      },
      description: `Booking request payment ${input.type} resolution recorded`,
    });
    return resolution;
  }

  private installmentAuditValue(row: Partial<InstallmentRow>) {
    return {
      requestId: row.bookingRequestId,
      label: row.label,
      sortOrder: row.sortOrder,
      fixedAmount: row.fixedAmount,
      percentage: row.percentage,
      resolvedAmount: row.resolvedAmount,
      dueMilestone: row.dueMilestone,
      dueDate: row.dueDate,
      allocatedAmount: row.allocatedAmount,
      status: row.status,
    };
  }

  private paymentResponse(row: PaymentRow) {
    return {
      id: row.id,
      propertyId: row.propertyId,
      bookingRequestId: row.bookingRequestId,
      folioId: row.folioId,
      method: row.method,
      status: row.status,
      amount: row.amount,
      currencyCode: row.currencyCode,
      gatewayProvider: row.gatewayProvider,
      gatewayTransactionId: row.gatewayTransactionId,
      cardLastFour: row.cardLastFour,
      cardBrand: row.cardBrand,
      originalPaymentId: row.originalPaymentId,
      notes: row.notes,
      processedAt: row.processedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private async audit(
    db: any,
    input: {
      propertyId: string;
      action: 'create' | 'update' | 'delete';
      entityType: string;
      entityId: string;
      actor?: AuditActor;
      previousValue?: Record<string, unknown>;
      newValue?: Record<string, unknown>;
      description: string;
    },
  ): Promise<void> {
    await db.insert(auditLogs).values({
      propertyId: input.propertyId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      ...actorFields(input.actor),
      previousValue: input.previousValue ?? null,
      newValue: input.newValue ?? null,
      description: input.description,
    });
  }
}
