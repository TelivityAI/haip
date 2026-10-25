import { createHash } from 'node:crypto';
import Decimal from 'decimal.js';
import type { ConnectPaymentMode, DepositPolicy } from '@telivityhaip/database';

export function hashBookRequest(payload: Record<string, unknown>): string {
  const canonical = JSON.stringify(payload, Object.keys(payload).sort());
  return createHash('sha256').update(canonical).digest('hex');
}

export function resolvePaymentMode(policy: DepositPolicy | null | undefined): ConnectPaymentMode {
  if (!policy || policy.type === 'none') return 'guarantee';
  return policy.refundable ? 'authorize' : 'charge';
}

export function computeDepositDue(
  policy: DepositPolicy | null | undefined,
  grandTotal: Decimal,
  nights: number,
): Decimal {
  if (!policy || policy.type === 'none') return new Decimal(0);
  switch (policy.type) {
    case 'full':
      return grandTotal;
    case 'percentage':
      return grandTotal.times(new Decimal(policy.percentage ?? 0).div(100)).toDecimalPlaces(2);
    case 'first_night':
    default:
      if (nights <= 0) return grandTotal;
      return grandTotal.div(nights).toDecimalPlaces(2);
  }
}
