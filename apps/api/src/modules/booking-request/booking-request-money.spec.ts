import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import {
  assertAllocationAmount,
  assertDenialMoneyResolved,
  resolveAcceptedTotal,
  resolveInstallmentAmount,
} from './booking-request-money';

describe('booking request money', () => {
  it('requires a reason for a custom accepted price', () => {
    expect(() => resolveAcceptedTotal({
      source: 'custom',
      submittedTotal: '1000.00',
      currentTotal: '1100.00',
      customTotal: '1050.00',
    })).toThrow(/reason/);
  });

  it('resolves submitted, current, and custom accepted totals as Decimal money', () => {
    expect(resolveAcceptedTotal({
      source: 'submitted', submittedTotal: '1000.00', currentTotal: '1100.00',
    })).toMatchObject({ source: 'submitted' });
    expect(resolveAcceptedTotal({
      source: 'current', submittedTotal: '1000.00', currentTotal: '1100.00',
    }).total).toEqual(new Decimal('1100.00'));
    expect(resolveAcceptedTotal({
      source: 'custom', submittedTotal: '1000.00', currentTotal: '1100.00',
      customTotal: '1050.00', customReason: 'Agreed rate',
    })).toMatchObject({ source: 'custom', customReason: 'Agreed rate' });
  });

  it('rejects non-positive custom totals', () => {
    expect(() => resolveAcceptedTotal({
      source: 'custom', customTotal: '0', customReason: 'No charge',
    })).toThrow(/positive/);
    expect(() => resolveAcceptedTotal({
      source: 'custom', customTotal: '-1', customReason: 'No charge',
    })).toThrow(/positive/);
  });

  it('resolves fixed and percentage installments with currency rounding', () => {
    expect(resolveInstallmentAmount({ total: '100.00', fixedAmount: '35.00' }))
      .toEqual(new Decimal('35.00'));
    expect(resolveInstallmentAmount({ total: '100.00', percentage: '33.333' }))
      .toEqual(new Decimal('33.33'));
  });

  it('rejects invalid installment amounts and allocations', () => {
    expect(() => resolveInstallmentAmount({ total: '100', fixedAmount: '0' })).toThrow(/positive/);
    expect(() => resolveInstallmentAmount({ total: '100', fixedAmount: '50', allocatedAmount: '51' }))
      .toThrow(/allocat/i);
    expect(() => assertAllocationAmount({ amount: '101', movementAmount: '100', installmentAmount: '200' }))
      .toThrow(/movement/);
    expect(() => assertAllocationAmount({ amount: '101', movementAmount: '200', installmentAmount: '100' }))
      .toThrow(/installment/);
  });

  it('requires each captured movement to be fully resolved on denial', () => {
    expect(() => assertDenialMoneyResolved(
      [{ id: 'payment-1', status: 'captured', amount: '100.00' }],
      [
        { paymentId: 'payment-1', type: 'external_return', amount: '40.00' },
        { paymentId: 'payment-1', type: 'retained', amount: '60.00' },
      ],
    )).not.toThrow();
    expect(() => assertDenialMoneyResolved(
      [{ id: 'payment-1', status: 'captured', amount: '100.00' }],
      [{ paymentId: 'payment-1', type: 'retained', amount: '99.99' }],
    )).toThrow(/payment-1/);
  });

  it('rejects zero and over-refunded resolutions', () => {
    expect(() => assertDenialMoneyResolved(
      [{ id: 'payment-1', status: 'captured', amount: '100.00' }],
      [{ paymentId: 'payment-1', type: 'refund', amount: '0' }],
    )).toThrow(/positive/);
    expect(() => assertDenialMoneyResolved(
      [{ id: 'payment-1', status: 'captured', amount: '100.00' }],
      [{ paymentId: 'payment-1', type: 'refund', amount: '100.01' }],
    )).toThrow(/payment-1/);
  });
});
