import { ConflictException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { buildAcceptedPricingSnapshot } from './booking-request-pricing';

const submitted = {
  currencyCode: 'EUR',
  grandTotal: '240.00',
  roomTotal: '200.00',
  taxTotal: '20.00',
  lineItems: [
    { date: '2026-10-01', rate: '100.00', tax: '10.00' },
    { date: '2026-10-02', rate: '100.00', tax: '10.00' },
  ],
  servicesTotal: '18.00',
  servicesTaxTotal: '2.00',
  services: [{
    serviceId: 'svc-breakfast',
    code: 'BREAKFAST',
    name: 'Breakfast',
    postingRule: 'once',
    chargeType: 'food_beverage',
    currencyCode: 'EUR',
    unitPrice: '18.00',
    quantity: 1,
    lineTotal: '18.00',
    taxTotal: '2.00',
    lineItems: [{ date: '2026-10-01', amount: '18.00', tax: '2.00' }],
  }],
};

const current = {
  ...structuredClone(submitted),
  grandTotal: '294.00',
  roomTotal: '240.00',
  lineItems: [
    { date: '2026-10-01', rate: '120.00', tax: '10.00' },
    { date: '2026-10-02', rate: '120.00', tax: '10.00' },
  ],
  servicesTotal: '30.00',
  servicesTaxTotal: '4.00',
  services: [{
    ...structuredClone(submitted.services[0]),
    postingRule: 'per_night',
    unitPrice: '15.00',
    quantity: 2,
    lineTotal: '30.00',
    taxTotal: '4.00',
    lineItems: [
      { date: '2026-10-01', amount: '15.00', tax: '2.00' },
      { date: '2026-10-02', amount: '15.00', tax: '2.00' },
    ],
  }],
};

describe('buildAcceptedPricingSnapshot', () => {
  it('freezes the selected current room, tax, and service components', () => {
    const snapshot = buildAcceptedPricingSnapshot({
      source: 'current',
      requestCurrencyCode: 'EUR',
      submittedQuote: submitted,
      currentQuote: current,
    });

    expect(snapshot).toEqual({
      version: 1,
      source: 'current',
      currencyCode: 'EUR',
      grandTotal: '294.00',
      roomTotal: '240.00',
      taxTotal: '20.00',
      nights: [
        { date: '2026-10-01', roomAmount: '120.00', taxAmount: '10.00' },
        { date: '2026-10-02', roomAmount: '120.00', taxAmount: '10.00' },
      ],
      servicesTotal: '30.00',
      servicesTaxTotal: '4.00',
      services: [{
        serviceId: 'svc-breakfast',
        code: 'BREAKFAST',
        name: 'Breakfast',
        postingRule: 'per_night',
        chargeType: 'food_beverage',
        currencyCode: 'EUR',
        unitPrice: '15.00',
        quantity: 2,
        lineTotal: '30.00',
        taxTotal: '4.00',
        lineItems: [
          { date: '2026-10-01', amount: '15.00', taxAmount: '2.00' },
          { date: '2026-10-02', amount: '15.00', taxAmount: '2.00' },
        ],
      }],
      customReason: null,
      adjustment: null,
    });
  });

  it('keeps quoted components and records one deterministic custom adjustment', () => {
    const snapshot = buildAcceptedPricingSnapshot({
      source: 'custom',
      requestCurrencyCode: 'EUR',
      submittedQuote: submitted,
      currentQuote: current,
      customTotal: '250.00',
      customReason: 'Loyalty recovery',
    });

    expect(snapshot.grandTotal).toBe('250.00');
    expect(snapshot.adjustment).toEqual({
      amount: '-44.00',
      reason: 'Loyalty recovery',
      serviceDate: '2026-10-01',
    });
    expect(snapshot.nights[0]?.roomAmount).toBe('120.00');
    expect(snapshot.services[0]?.lineTotal).toBe('30.00');
  });

  it('preserves the mandatory custom reason when the custom total equals current', () => {
    const snapshot = buildAcceptedPricingSnapshot({
      source: 'custom',
      requestCurrencyCode: 'EUR',
      submittedQuote: submitted,
      currentQuote: current,
      customTotal: '294.00',
      customReason: 'Matched a written offer',
    });

    expect(snapshot).toMatchObject({
      source: 'custom',
      grandTotal: '294.00',
      customReason: 'Matched a written offer',
      adjustment: null,
    });
  });

  it('rejects a quote currency that differs from the request currency', () => {
    expect(() => buildAcceptedPricingSnapshot({
      source: 'submitted',
      requestCurrencyCode: 'USD',
      submittedQuote: submitted,
      currentQuote: current,
    })).toThrow(ConflictException);
  });

  it('rejects component totals that do not equal their immutable posting lines', () => {
    const incoherent = {
      ...structuredClone(current),
      roomTotal: '241.00',
      grandTotal: '295.00',
    };

    expect(() => buildAcceptedPricingSnapshot({
      source: 'current',
      requestCurrencyCode: 'EUR',
      submittedQuote: submitted,
      currentQuote: incoherent,
    })).toThrow(/nightly room/i);
  });
});
