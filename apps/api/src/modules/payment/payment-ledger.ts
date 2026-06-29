import { and, eq, inArray, isNull, or, type SQL } from 'drizzle-orm';
import { payments } from '@telivityhaip/database';
import Decimal from 'decimal.js';

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

/** Sum refund / correction child rows already posted against a parent payment. */
export function sumRefundChildren(
  rows: Array<{ amount: string | number }>,
): Decimal {
  return rows.reduce(
    (sum, r) => sum.plus(new Decimal(r.amount).abs()),
    new Decimal(0),
  );
}
