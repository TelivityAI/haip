import Decimal from 'decimal.js';
import { and, eq } from 'drizzle-orm';
import {
  auditLogs,
  bookingRequestInstallments,
  bookingRequestPaymentAllocations,
  payments,
} from '@telivityhaip/database';
import type { AuditActor } from '../../common/audit/audit-actor';
import { actorFields } from '../../common/audit/audit-actor';
import { remainingCapturedAmount } from '../payment/payment-ledger';

export type ReconciledAllocationInput = {
  id: string;
  installmentId: string;
  amount: string;
  createdAt?: Date | null;
};

export type NetAllocationReconciliation = {
  allocationAmounts: Map<string, string>;
  installmentTotals: Map<string, string>;
};

/**
 * Preserve the oldest allocation evidence first and release newest allocations
 * deterministically when a return reduces a movement's net captured value.
 */
export function planNetAllocationReconciliation(
  netCapturedAmount: string,
  allocations: readonly ReconciledAllocationInput[],
): NetAllocationReconciliation {
  let remaining = Decimal.max(new Decimal(netCapturedAmount), 0);
  const sorted = [...allocations].sort((left, right) => {
    const time = (left.createdAt?.getTime() ?? 0) - (right.createdAt?.getTime() ?? 0);
    return time !== 0 ? time : left.id.localeCompare(right.id);
  });
  const allocationAmounts = new Map<string, string>();
  const installmentTotals = new Map<string, string>();
  for (const allocation of sorted) {
    const existing = new Decimal(allocation.amount);
    const retained = Decimal.min(existing, remaining);
    const amount = retained.toFixed(2);
    allocationAmounts.set(allocation.id, amount);
    installmentTotals.set(
      allocation.installmentId,
      new Decimal(installmentTotals.get(allocation.installmentId) ?? 0)
        .plus(retained)
        .toFixed(2),
    );
    remaining = Decimal.max(remaining.minus(retained), 0);
  }
  return { allocationAmounts, installmentTotals };
}

type ReconciliationPayment = { id: string; amount: string };

/**
 * Apply a movement's net captured capacity to its allocation evidence. The
 * caller must already hold the Booking Request and parent-payment locks, so
 * installment locks are always acquired last.
 */
export async function reconcileBookingRequestPaymentAllocations(
  tx: any,
  input: {
    bookingRequestId: string;
    propertyId: string;
    payment: ReconciliationPayment;
    actor?: AuditActor;
  },
): Promise<void> {
  const allRows = await tx
    .select()
    .from(bookingRequestPaymentAllocations)
    .where(and(
      eq(bookingRequestPaymentAllocations.bookingRequestId, input.bookingRequestId),
      eq(bookingRequestPaymentAllocations.propertyId, input.propertyId),
    ));
  const allAllocations = (allRows as Array<ReconciledAllocationInput & {
    propertyId: string;
    bookingRequestId: string;
    paymentId: string;
  }>).filter((row) =>
    row.propertyId === input.propertyId && row.bookingRequestId === input.bookingRequestId);
  const movementAllocations = allAllocations.filter((row) => row.paymentId === input.payment.id);
  if (movementAllocations.length === 0) return;

  const childRows = await tx
    .select()
    .from(payments)
    .where(and(
      eq(payments.originalPaymentId, input.payment.id),
      eq(payments.bookingRequestId, input.bookingRequestId),
      eq(payments.propertyId, input.propertyId),
      eq(payments.status, 'captured'),
    ));
  const children = (childRows as Array<{
    originalPaymentId: string | null;
    bookingRequestId: string | null;
    propertyId: string;
    status: string;
    amount: string;
  }>).filter((row) =>
    row.originalPaymentId === input.payment.id
    && row.bookingRequestId === input.bookingRequestId
    && row.propertyId === input.propertyId
    && row.status === 'captured');
  const netCaptured = remainingCapturedAmount(input.payment.amount, children);
  const plan = planNetAllocationReconciliation(
    netCaptured.toFixed(2),
    movementAllocations,
  );
  const affectedInstallments = new Set<string>();

  for (const allocation of movementAllocations) {
    const nextAmount = plan.allocationAmounts.get(allocation.id) ?? '0.00';
    if (new Decimal(nextAmount).eq(allocation.amount)) continue;
    affectedInstallments.add(allocation.installmentId);
    if (new Decimal(nextAmount).isZero()) {
      await tx
        .delete(bookingRequestPaymentAllocations)
        .where(and(
          eq(bookingRequestPaymentAllocations.id, allocation.id),
          eq(bookingRequestPaymentAllocations.propertyId, input.propertyId),
          eq(bookingRequestPaymentAllocations.bookingRequestId, input.bookingRequestId),
        ));
    } else {
      await tx
        .update(bookingRequestPaymentAllocations)
        .set({ amount: nextAmount })
        .where(and(
          eq(bookingRequestPaymentAllocations.id, allocation.id),
          eq(bookingRequestPaymentAllocations.propertyId, input.propertyId),
          eq(bookingRequestPaymentAllocations.bookingRequestId, input.bookingRequestId),
        ));
    }
    await tx.insert(auditLogs).values({
      propertyId: input.propertyId,
      bookingRequestId: input.bookingRequestId,
      action: new Decimal(nextAmount).isZero() ? 'delete' : 'update',
      entityType: 'booking_request_payment_allocation',
      entityId: allocation.id,
      ...actorFields(input.actor),
      previousValue: { amount: allocation.amount },
      newValue: { amount: nextAmount, reason: 'payment_net_reduced' },
      description: 'Booking request allocation reduced after payment return',
    });
  }

  if (affectedInstallments.size === 0) return;
  const allAfter = allAllocations
    .map((allocation) => allocation.paymentId === input.payment.id
      ? { ...allocation, amount: plan.allocationAmounts.get(allocation.id) ?? '0.00' }
      : allocation)
    .filter((allocation) => new Decimal(allocation.amount).gt(0));
  for (const installmentId of affectedInstallments) {
    const rows = await tx
      .select()
      .from(bookingRequestInstallments)
      .where(and(
        eq(bookingRequestInstallments.id, installmentId),
        eq(bookingRequestInstallments.propertyId, input.propertyId),
        eq(bookingRequestInstallments.bookingRequestId, input.bookingRequestId),
      ))
      .for('update');
    const installment = rows.find((row: typeof bookingRequestInstallments.$inferSelect) =>
      row.id === installmentId);
    if (!installment?.resolvedAmount) {
      throw new Error(`Installment ${installmentId} has no resolved amount`);
    }
    const allocated = allAfter
      .filter((row) => row.installmentId === installmentId)
      .reduce((sum, row) => sum.plus(row.amount), new Decimal(0));
    const resolved = new Decimal(installment.resolvedAmount);
    const status = allocated.isZero() ? 'unpaid' : allocated.gte(resolved) ? 'paid' : 'partial';
    await tx
      .update(bookingRequestInstallments)
      .set({ allocatedAmount: allocated.toFixed(2), status, updatedAt: new Date() })
      .where(and(
        eq(bookingRequestInstallments.id, installmentId),
        eq(bookingRequestInstallments.propertyId, input.propertyId),
        eq(bookingRequestInstallments.bookingRequestId, input.bookingRequestId),
      ));
  }
}
