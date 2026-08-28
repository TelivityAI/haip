import { BadRequestException, ConflictException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import type { AcceptedPricingSnapshot } from './booking-request-db.js';
import {
  buildAmendedPricingSnapshot,
  buildPriorAmendedPricingSnapshot,
  withoutCancelledAcceptedServices,
} from './booking-request-amendment-pricing.js';

const previous: AcceptedPricingSnapshot = {
  version: 1,
  source: 'custom',
  currencyCode: 'EUR',
  grandTotal: '253.00',
  roomTotal: '200.00',
  taxTotal: '20.00',
  nights: [
    { date: '2026-10-01', roomAmount: '100.00', taxAmount: '10.00' },
    { date: '2026-10-02', roomAmount: '100.00', taxAmount: '10.00' },
  ],
  services: [
    {
      serviceId: 'breakfast',
      code: 'BREAKFAST',
      name: 'Breakfast',
      postingRule: 'per_night',
      chargeType: 'food_beverage',
      currencyCode: 'EUR',
      unitPrice: '15.00',
      quantity: 2,
      lineTotal: '30.00',
      taxTotal: '3.00',
      lineItems: [
        { date: '2026-10-01', amount: '15.00', taxAmount: '1.50' },
        { date: '2026-10-02', amount: '15.00', taxAmount: '1.50' },
      ],
    },
    {
      serviceId: 'parking',
      code: 'PARKING',
      name: 'Parking',
      postingRule: 'once',
      chargeType: 'parking',
      currencyCode: 'EUR',
      unitPrice: '20.00',
      quantity: 1,
      lineTotal: '20.00',
      taxTotal: '2.00',
      lineItems: [
        { date: '2026-10-01', amount: '20.00', taxAmount: '2.00' },
      ],
    },
  ],
  servicesTotal: '50.00',
  servicesTaxTotal: '5.00',
  customReason: 'Written offer',
  adjustment: {
    amount: '-22.00',
    reason: 'Written offer',
    serviceDate: '2026-10-01',
  },
};

const currentQuote = {
  currencyCode: 'EUR',
  grandTotal: '396.00',
  roomTotal: '330.00',
  taxTotal: '33.00',
  lineItems: [
    { date: '2026-10-01', rate: '110.00', tax: '11.00' },
    { date: '2026-10-02', rate: '110.00', tax: '11.00' },
    { date: '2026-10-03', rate: '110.00', tax: '11.00' },
  ],
  servicesTotal: '30.00',
  servicesTaxTotal: '3.00',
  services: [{
    serviceId: 'breakfast',
    code: 'BREAKFAST',
    name: 'Breakfast',
    postingRule: 'per_night',
    chargeType: 'food_beverage',
    currencyCode: 'EUR',
    unitPrice: '10.00',
    quantity: 3,
    lineTotal: '30.00',
    taxTotal: '3.00',
    lineItems: [
      { date: '2026-10-01', amount: '10.00', tax: '1.00' },
      { date: '2026-10-02', amount: '10.00', tax: '1.00' },
      { date: '2026-10-03', amount: '10.00', tax: '1.00' },
    ],
  }],
};

describe('Booking Request prior amendment pricing', () => {
  it('removes cancelled operational services and recomputes every aggregate exactly', () => {
    const operational = withoutCancelledAcceptedServices(previous, new Set(['parking']));

    expect(operational.services.map((service) => service.serviceId)).toEqual(['breakfast']);
    expect(operational).toMatchObject({
      servicesTotal: '30.00',
      servicesTaxTotal: '3.00',
      grandTotal: '231.00',
    });
    expect(previous.services).toHaveLength(2);
  });

  it('preserves overlap and clones the nearest immutable boundary basis for extension nights', () => {
    const amended = buildPriorAmendedPricingSnapshot(
      previous,
      '2026-09-30',
      '2026-10-04',
    );

    expect(amended).toMatchObject({
      source: 'prior',
      currencyCode: 'EUR',
      roomTotal: '400.00',
      taxTotal: '40.00',
      servicesTotal: '80.00',
      servicesTaxTotal: '8.00',
      grandTotal: '506.00',
      adjustment: {
        amount: '-22.00',
        reason: 'Written offer',
        serviceDate: '2026-10-01',
      },
    });
    expect(amended.nights).toEqual([
      { date: '2026-09-30', roomAmount: '100.00', taxAmount: '10.00' },
      previous.nights[0],
      previous.nights[1],
      { date: '2026-10-03', roomAmount: '100.00', taxAmount: '10.00' },
    ]);
    expect(amended.services[0]?.lineItems).toEqual([
      { date: '2026-09-30', amount: '15.00', taxAmount: '1.50' },
      previous.services[0]!.lineItems[0],
      previous.services[0]!.lineItems[1],
      { date: '2026-10-03', amount: '15.00', taxAmount: '1.50' },
    ]);
    expect(amended.services[1]).toMatchObject({
      postingRule: 'once',
      quantity: 1,
      lineTotal: '20.00',
      taxTotal: '2.00',
    });
    expect(amended.services[1]?.lineItems).toEqual([
      previous.services[1]!.lineItems[0],
    ]);
  });

  it('removes omitted nightly basis and reanchors fixed once/adjustment lines when shortening', () => {
    const amended = buildPriorAmendedPricingSnapshot(
      previous,
      '2026-10-02',
      '2026-10-03',
    );

    expect(amended).toMatchObject({
      roomTotal: '100.00',
      taxTotal: '10.00',
      servicesTotal: '35.00',
      servicesTaxTotal: '3.50',
      grandTotal: '126.50',
      adjustment: { amount: '-22.00', serviceDate: '2026-10-02' },
    });
    expect(amended.services[0]?.lineItems).toEqual([
      previous.services[0]!.lineItems[1],
    ]);
    expect(amended.services[1]?.lineItems).toEqual([
      { date: '2026-10-02', amount: '20.00', taxAmount: '2.00' },
    ]);
  });
});

describe('Booking Request current/custom amendment pricing', () => {
  it('normalizes the authoritative amended quote for the current choice', () => {
    const amended = buildAmendedPricingSnapshot({
      source: 'current',
      previous,
      currentQuote,
      currencyCode: 'EUR',
      arrivalDate: '2026-10-01',
      departureDate: '2026-10-04',
    });

    expect(amended).toMatchObject({
      source: 'current',
      grandTotal: '396.00',
      adjustment: null,
    });
    expect(amended.nights[0]).toEqual({
      date: '2026-10-01',
      roomAmount: '110.00',
      taxAmount: '11.00',
    });
  });

  it('requires an exact positive custom total and reason in the reservation currency', () => {
    expect(() => buildAmendedPricingSnapshot({
      source: 'custom',
      previous,
      currentQuote,
      currencyCode: 'EUR',
      arrivalDate: '2026-10-01',
      departureDate: '2026-10-04',
      customTotal: '390.00',
      customReason: '  Matched signed offer  ',
    })).not.toThrow();

    expect(() => buildAmendedPricingSnapshot({
      source: 'custom',
      previous,
      currentQuote,
      currencyCode: 'EUR',
      arrivalDate: '2026-10-01',
      departureDate: '2026-10-04',
      customTotal: '0.00',
      customReason: 'No',
    })).toThrow(BadRequestException);

    expect(() => buildAmendedPricingSnapshot({
      source: 'current',
      previous,
      currentQuote: { ...currentQuote, currencyCode: 'USD' },
      currencyCode: 'EUR',
      arrivalDate: '2026-10-01',
      departureDate: '2026-10-04',
    })).toThrow(ConflictException);
  });
});
