import { describe, it, expect } from 'vitest';
import {
  computeDepositDue,
  hashBookRequest,
  resolvePaymentMode,
} from './connect-payment.helpers';
import Decimal from 'decimal.js';

describe('connect payment helpers', () => {
  it('hashes book requests stably', () => {
    const a = hashBookRequest({ propertyId: 'p1', adults: 2, checkIn: '2026-06-01' });
    const b = hashBookRequest({ adults: 2, checkIn: '2026-06-01', propertyId: 'p1' });
    const c = hashBookRequest({ propertyId: 'p1', adults: 3, checkIn: '2026-06-01' });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it('maps depositPolicy to paymentMode charge/authorize/guarantee', () => {
    expect(resolvePaymentMode({ type: 'none', refundable: true })).toBe('guarantee');
    expect(resolvePaymentMode({ type: 'first_night', refundable: true })).toBe('authorize');
    expect(resolvePaymentMode({ type: 'full', refundable: false })).toBe('charge');
    expect(resolvePaymentMode({ type: 'percentage', percentage: 30, refundable: true })).toBe('authorize');
  });

  it('computes deposit due from policy', () => {
    const total = new Decimal('400.00');
    expect(computeDepositDue({ type: 'none', refundable: true }, total, 2).toNumber()).toBe(0);
    expect(computeDepositDue({ type: 'full', refundable: false }, total, 2).toNumber()).toBe(400);
    expect(computeDepositDue({ type: 'first_night', refundable: true }, total, 2).toNumber()).toBe(200);
    expect(
      computeDepositDue({ type: 'percentage', percentage: 25, refundable: false }, total, 2).toNumber(),
    ).toBe(100);
  });
});
