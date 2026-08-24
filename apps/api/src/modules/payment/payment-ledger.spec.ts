import { describe, it, expect } from 'vitest';
import { remainingCapturedAmount, sumRefundChildren } from './payment-ledger';

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

  it('calculates exact remaining captured money across partial child movements', () => {
    expect(remainingCapturedAmount('100.00', [
      { amount: '-30.10' },
      { amount: '-19.90' },
    ]).toFixed(2)).toBe('50.00');
  });
});
