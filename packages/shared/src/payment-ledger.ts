import { Decimal } from 'decimal.js';

/** Sum refund / correction child rows already posted against a parent payment. */
export function sumRefundChildren(
  rows: Array<{ amount: string | number }>,
): Decimal {
  return rows.reduce(
    (sum, r) => sum.plus(new Decimal(r.amount).abs()),
    new Decimal(0),
  );
}

/** Exact remaining captured value after canonical negative child movements. */
export function remainingCapturedAmount(
  capturedAmount: string | number,
  childRows: Array<{ amount: string | number }>,
): Decimal {
  return new Decimal(capturedAmount).minus(sumRefundChildren(childRows));
}
