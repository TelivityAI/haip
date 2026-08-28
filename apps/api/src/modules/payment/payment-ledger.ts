import { and, eq, inArray, isNull, or, type SQL } from 'drizzle-orm';
import { payments } from '@telivityhaip/database';

/** Canonical definitions live in @telivityhaip/shared (used by @telivityhaip/booking-requests too). */
export { remainingCapturedAmount, sumRefundChildren } from '@telivityhaip/shared';

/**
 * Net folio / cash-report payment ledger:
 *
 * - Parent tenders stay `captured` (or `settled`); refunds and payment corrections
 *   are negative child rows, also `captured`, linked via `originalPaymentId`.
 * - Do not flip the parent to `refunded` / `partially_refunded` for balance math —
 *   that drops the positive amount while the negative child remains.
 * - Legacy parents still marked `partially_refunded` / `refunded` (pre-fix rows)
 *   remain summable so recalculate heals existing data.
 */
export const FOLIO_PARENT_PAYMENT_STATUSES = [
  'captured',
  'settled',
  'partially_refunded',
  'refunded',
] as const;

/** Parent payment statuses whose positive amount is included in folio net math. */
export function parentCountsTowardFolioBalance(status: string): boolean {
  return (FOLIO_PARENT_PAYMENT_STATUSES as readonly string[]).includes(status);
}

/** Payment rows that count toward a folio balance. */
export function folioPaymentSumWhere(
  folioId: string,
  propertyId: string,
): SQL {
  return and(
    eq(payments.folioId, folioId),
    eq(payments.propertyId, propertyId),
    or(
      eq(payments.status, 'captured'),
      and(
        isNull(payments.originalPaymentId),
        inArray(payments.status, [...FOLIO_PARENT_PAYMENT_STATUSES]),
      ),
    ),
  )!;
}

/** Payment rows that count toward a pre/post-acceptance Booking Request net. */
export function bookingRequestPaymentSumWhere(
  bookingRequestId: string,
  propertyId: string,
): SQL {
  return and(
    eq(payments.bookingRequestId, bookingRequestId),
    eq(payments.propertyId, propertyId),
    or(
      eq(payments.status, 'captured'),
      and(
        isNull(payments.originalPaymentId),
        inArray(payments.status, [...FOLIO_PARENT_PAYMENT_STATUSES]),
      ),
    ),
  )!;
}

/** Payment rows that count toward property-scoped cash reports (same net model). */
export function reportPaymentSumWhere(propertyId: string): SQL {
  return and(
    eq(payments.propertyId, propertyId),
    or(
      eq(payments.status, 'captured'),
      and(
        isNull(payments.originalPaymentId),
        inArray(payments.status, [...FOLIO_PARENT_PAYMENT_STATUSES]),
      ),
    ),
  )!;
}
