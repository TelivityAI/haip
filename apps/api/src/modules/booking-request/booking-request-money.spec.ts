import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import {
  assertAllocationAmount,
  assertDenialMoneyResolved,
  assertLedgerCurrencySupported,
  resolveAcceptedTotal,
  resolveInstallmentAmount,
} from './booking-request-money';

describe('booking request money', () => {
  it('returns supported ISO currency exponents and rejects unknown or scale-three ISO currencies', () => {
    expect(assertLedgerCurrencySupported(' usd ')).toBe(2);
    expect(assertLedgerCurrencySupported('JPY')).toBe(0);
    for (const currencyCode of ['BHD', 'IQD', 'KWD', 'LYD', 'OMR', 'TND']) {
      expect(() => assertLedgerCurrencySupported(currencyCode))
        .toThrow(new RegExp(`${currencyCode}.*scale-two payment ledger`, 'i'));
    }
    expect(() => assertLedgerCurrencySupported('ZZZ')).toThrow(/unsupported ISO-4217 currency/i);
  });

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

  it('rounds percentage installments to the supplied ISO currency exponent', () => {
    expect(resolveInstallmentAmount({
      total: '101', percentage: '50', currencyExponent: 0,
    })).toEqual(new Decimal('51'));
    expect(resolveInstallmentAmount({
      total: '101.00', percentage: '50', currencyExponent: 2,
    })).toEqual(new Decimal('50.50'));
  });

  it('rejects invalid installment amounts and allocations', () => {
    expect(() => resolveInstallmentAmount({ total: '100', fixedAmount: '0' })).toThrow(/positive/);
    expect(() => resolveInstallmentAmount({ total: '100', fixedAmount: '50', allocatedAmount: '51' }))
      .toThrow(/allocat/i);
    expect(() => assertAllocationAmount({ amount: '101', movementAmount: '100', installmentAmount: '200' }))
      .toThrow(/movement/);
    expect(() => assertAllocationAmount({ amount: '101', movementAmount: '200', installmentAmount: '100' }))
      .toThrow(/installment/);
    expect(() => assertAllocationAmount({
      amount: '60', movementAmount: '100', installmentAmount: '100',
      alreadyAllocatedMovementAmount: '50',
    })).toThrow(/movement/);
    expect(() => assertAllocationAmount({
      amount: '60', movementAmount: '100', installmentAmount: '100',
      alreadyAllocatedInstallmentAmount: '50',
    })).toThrow(/installment/);
  });

  it('requires each captured movement to be fully resolved on denial', () => {
    expect(() => assertDenialMoneyResolved(
      [{ id: 'payment-1', status: 'captured', amount: '100.00' }],
      [
        { paymentId: 'payment-1', type: 'external_return', amount: '40.00' },
        { paymentId: 'payment-1', type: 'retained', amount: '60.00', reason: 'Cancellation fee retained' },
      ],
    )).not.toThrow();
    expect(() => assertDenialMoneyResolved(
      [{ id: 'payment-1', status: 'captured', amount: '100.00' }],
      [{ paymentId: 'payment-1', type: 'retained', amount: '99.99', reason: 'Partial retention' }],
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

  it('requires a non-blank reason when money is retained', () => {
    expect(() => assertDenialMoneyResolved(
      [{ id: 'payment-1', status: 'captured', amount: '100.00' }],
      [{ paymentId: 'payment-1', type: 'retained', amount: '100.00' }],
    )).toThrow(/reason/);
    expect(() => assertDenialMoneyResolved(
      [{ id: 'payment-1', status: 'captured', amount: '100.00' }],
      [{ paymentId: 'payment-1', type: 'retained', amount: '100.00', reason: '  ' }],
    )).toThrow(/reason/);
  });

  it('does not require a fully refunded movement whose net amount is zero', () => {
    expect(() => assertDenialMoneyResolved(
      [{ id: 'payment-1', status: 'captured', amount: '100.00', netAmount: '0.00' }],
      [],
    )).not.toThrow();
    expect(() => assertDenialMoneyResolved(
      [{ id: 'payment-1', status: 'captured', amount: '100.00', netAmount: '0.00' }],
      [{ paymentId: 'payment-1', type: 'refund', amount: '100.00' }],
    )).not.toThrow();
  });

  it('rejects negative captured or net movement amounts', () => {
    expect(() => assertDenialMoneyResolved(
      [{ id: 'payment-1', status: 'captured', amount: '-1.00' }],
      [],
    )).toThrow(/negative/);
    expect(() => assertDenialMoneyResolved(
      [{ id: 'payment-1', status: 'captured', amount: '100.00', netAmount: '-0.01' }],
      [],
    )).toThrow(/negative/);
  });
});
