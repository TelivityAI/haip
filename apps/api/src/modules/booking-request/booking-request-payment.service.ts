import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
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
  SAVED_PAYMENT_METHOD_GATEWAY,
  type SavedPaymentMethodGateway,
} from '../payment/interfaces/saved-payment-method-gateway.interface';
import { PaymentService } from '../payment/payment.service';
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
    @Inject(PaymentService) private readonly paymentService: PaymentService,
    @Inject(FolioService) private readonly folioService: FolioService,
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
      const installment = await this.findInstallment(
        tx,
        bookingRequestId,
        installmentId,
        propertyId,
        true,
      );
      const payment = await this.findParentPayment(
        tx,
        bookingRequestId,
        input.paymentId,
        propertyId,
        true,
      );
      if (!['captured', 'settled', 'partially_refunded', 'refunded'].includes(payment.status)) {
        throw new ConflictException('Only captured payment movements can be allocated');
      }
      const amount = this.positiveMoney(input.amount, request.currencyCode, 'Allocation amount');
      const installmentAmount = this.resolvedInstallmentAmount(installment);
      const allocations = await this.scopedAllocations(tx, bookingRequestId, propertyId);
      const paymentAllocated = allocations
        .filter((row) => row.paymentId === payment.id)
        .reduce((sum, row) => sum.plus(row.amount), new Decimal(0));
      const installmentAllocated = allocations
        .filter((row) => row.installmentId === installment.id)
        .reduce((sum, row) => sum.plus(row.amount), new Decimal(0));
      assertAllocationAmount({
        amount,
        movementAmount: payment.amount,
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
        const existing = await this.findPaymentByIdempotency(tx, propertyId, idempotencyKey);
        this.assertPaymentReplay(existing, {
          bookingRequestId,
          amount: amount.toFixed(2),
          currencyCode: request.currencyCode,
          method: 'credit_card',
        }, 'charge idempotency key');
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

    if (!prepared.isNew) return this.paymentResponse(prepared.payment);

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
      gatewayResult = {
        success: false,
        transactionId: '',
        requiresAction: false,
        errorMessage: error instanceof Error ? error.message : 'Saved-card charge failed',
      };
    }

    const finalized = await this.db.transaction(async (tx: any) => {
      const existing = await this.findPayment(tx, prepared.payment.id, propertyId, true);
      if (existing.status !== 'pending') return existing;
      const status: PaymentRow['status'] = gatewayResult.success ? 'captured' : 'failed';
      const changes = {
        status,
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
      return updated;
    });

    if (finalized.status === 'captured' && finalized.folioId) {
      await this.folioService.recalculateBalance(finalized.folioId, propertyId);
    }
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
    const idempotencyKey = this.scopedKey(
      'external',
      propertyId,
      `${provider}:${reference}`,
    );
    const result = await this.db.transaction(async (tx: any) => {
      const request = await this.findRequest(tx, bookingRequestId, propertyId, true);
      this.assertNotDenied(request);
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
        }, 'external payment reference');
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
      return { payment: created, isNew: true };
    });
    if (result.isNew && result.payment.folioId) {
      await this.folioService.recalculateBalance(result.payment.folioId, propertyId);
    }
    return this.paymentResponse(result.payment);
  }

  async refund(
    bookingRequestId: string,
    paymentId: string,
    propertyId: string,
    input: RefundBookingRequestPaymentDto,
    actor?: AuditActor,
  ) {
    const request = await this.findRequest(this.db, bookingRequestId, propertyId);
    this.assertNotDenied(request);
    const original = await this.findParentPayment(
      this.db,
      bookingRequestId,
      paymentId,
      propertyId,
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
    await this.assertResolutionCapacity(
      this.db,
      bookingRequestId,
      propertyId,
      original,
      amount,
    );
    const idempotencyKey = this.scopedKey('refund', propertyId, input.idempotencyKey);
    const movement = await this.paymentService.refundPayment(
      paymentId,
      propertyId,
      amount.toFixed(2),
      { idempotencyKey },
    );
    const resolution = await this.recordResolution({
      bookingRequestId,
      propertyId,
      paymentId,
      type: 'refund',
      amount: new Decimal(movement.amount).abs().toFixed(2),
      reason: `Gateway refund movement ${movement.id}`,
      actor,
      marker: movement.id,
    });
    return { movement: this.paymentResponse(movement), resolution };
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
        this.assertPaymentReplay(existing, {
          bookingRequestId,
          amount: amount.negated().toFixed(2),
          currencyCode: original.currencyCode,
          method: original.method,
          reference,
          originalPaymentId: original.id,
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
          folioId: original.folioId,
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
      return { movement, resolution, isNew: true };
    });
    if (result.isNew && result.movement.folioId) {
      await this.folioService.recalculateBalance(result.movement.folioId, propertyId);
    }
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
      this.assertNotDenied(request);
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
    },
    identityLabel: string,
  ): void {
    if (
      existing.bookingRequestId !== expected.bookingRequestId
      || !new Decimal(existing.amount).eq(expected.amount)
      || existing.currencyCode.toUpperCase() !== expected.currencyCode.toUpperCase()
      || existing.method !== expected.method
      || (expected.reference != null && existing.gatewayTransactionId !== expected.reference)
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
      .filter((row) => row.paymentId === payment.id)
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
