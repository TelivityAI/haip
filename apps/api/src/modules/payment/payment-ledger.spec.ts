import { describe, it, expect } from 'vitest';
import { sumRefundChildren } from './payment-ledger';

describe('payment-ledger', () => {
  describe('sumRefundChildren', () => {
    it('sums absolute values of refund child amounts', () => {
      const total = sumRefundChildren([
        { amount: '-50.00' },
        { amount: '-30.00' },
      ]);
      expect(total.toFixed(2)).toBe('80.00');
    });

    it('returns zero when there are no children', () => {
      expect(sumRefundChildren([]).toFixed(2)).toBe('0.00');
    });
  });
});
