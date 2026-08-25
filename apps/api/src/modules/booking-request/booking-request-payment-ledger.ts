import Decimal from 'decimal.js';
import { remainingCapturedAmount } from '../payment/payment-ledger';

export const BOOKING_REQUEST_PARENT_PAYMENT_STATUSES = new Set([
  'captured',
  'settled',
  'partially_refunded',
  'refunded',
]);

export type BookingRequestLedgerMovement = {
  id: string;
  originalPaymentId?: string | null;
  status: string;
  amount: string;
};

export type BookingRequestLedgerAllocation = {
  paymentId: string;
  amount: string;
};

export type BookingRequestLedgerResolution = {
  paymentId: string;
  type?: string | null;
  status?: string | null;
  amount: string;
  movementId?: string | null;
};

export type BookingRequestPaymentLedgerSummary = {
  netCaptured: Decimal;
  allocated: Decimal;
  reservedResolution: Decimal;
  completedResolution: Decimal;
  availableToAllocate: Decimal;
  availableToResolve: Decimal;
  unresolved: Decimal;
  returned: Decimal;
  retained: Decimal;
};

const ZERO_SUMMARY = (): BookingRequestPaymentLedgerSummary => ({
  netCaptured: new Decimal(0),
  allocated: new Decimal(0),
  reservedResolution: new Decimal(0),
  completedResolution: new Decimal(0),
  availableToAllocate: new Decimal(0),
  availableToResolve: new Decimal(0),
  unresolved: new Decimal(0),
  returned: new Decimal(0),
  retained: new Decimal(0),
});

/**
 * Canonical per-parent Booking Request money view.
 *
 * Captured negative child movements are the ledger fact and reduce net once.
 * A completed resolution backed by one of those movements is provenance only;
 * completed movement-less legacy/retained resolutions consume the remaining
 * unresolved balance. Pending durable claims reserve, but do not resolve, it.
 */
export function summarizeBookingRequestPaymentLedger(
  payment: BookingRequestLedgerMovement,
  movements: readonly BookingRequestLedgerMovement[],
  allocations: readonly BookingRequestLedgerAllocation[],
  resolutions: readonly BookingRequestLedgerResolution[],
): BookingRequestPaymentLedgerSummary {
  if (
    payment.originalPaymentId != null
    || !BOOKING_REQUEST_PARENT_PAYMENT_STATUSES.has(payment.status)
    || new Decimal(payment.amount).lte(0)
  ) return ZERO_SUMMARY();

  const children = movements.filter((row) =>
    row.originalPaymentId === payment.id
    && row.status === 'captured'
    && new Decimal(row.amount).lt(0));
  const childIds = new Set(children.map((row) => row.id));
  const netCaptured = Decimal.max(remainingCapturedAmount(payment.amount, children), 0);
  const allocated = allocations
    .filter((row) => row.paymentId === payment.id)
    .reduce((sum, row) => sum.plus(row.amount), new Decimal(0));
  const paymentResolutions = resolutions.filter((row) => row.paymentId === payment.id);
  const reservedResolution = paymentResolutions
    .filter((row) => row.status === 'pending')
    .reduce((sum, row) => sum.plus(row.amount), new Decimal(0));
  const completedWithoutMovement = paymentResolutions
    .filter((row) => row.status == null || row.status === 'completed')
    .filter((row) => !row.movementId || !childIds.has(row.movementId));
  const completedResolution = completedWithoutMovement
    .reduce((sum, row) => sum.plus(row.amount), new Decimal(0));
  const retained = completedWithoutMovement
    .filter((row) => row.type === 'retained')
    .reduce((sum, row) => sum.plus(row.amount), new Decimal(0));
  const returned = new Decimal(payment.amount)
    .minus(netCaptured)
    .plus(completedWithoutMovement
      .filter((row) => row.type !== 'retained')
      .reduce((sum, row) => sum.plus(row.amount), new Decimal(0)));
  const unresolved = Decimal.max(netCaptured.minus(completedResolution), 0);
  const availableToResolve = Decimal.max(unresolved.minus(reservedResolution), 0);
  const availableToAllocate = Decimal.max(availableToResolve.minus(allocated), 0);

  return {
    netCaptured,
    allocated,
    reservedResolution,
    completedResolution,
    availableToAllocate,
    availableToResolve,
    unresolved,
    returned,
    retained,
  };
}
