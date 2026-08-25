import type { AcceptedPricingSnapshot } from '@telivityhaip/database';
import { ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { FolioService } from './folio.service';

const oldPricing: AcceptedPricingSnapshot = {
  version: 1,
  source: 'current',
  currencyCode: 'EUR',
  grandTotal: '220.00',
  roomTotal: '200.00',
  taxTotal: '20.00',
  nights: [
    { date: '2026-10-01', roomAmount: '100.00', taxAmount: '10.00' },
    { date: '2026-10-02', roomAmount: '100.00', taxAmount: '10.00' },
  ],
  services: [],
  servicesTotal: '0.00',
  servicesTaxTotal: '0.00',
  customReason: null,
  adjustment: null,
};

const PROPERTY = 'property-1';
const FOLIO = 'folio-1';
const RESERVATION = 'reservation-1';
const AMENDMENT = 'amendment-1';

function roomGroup(
  date: string,
  suffix: string,
  options: { locked?: boolean; room?: string; tax?: string } = {},
) {
  const baseId = `room-${suffix}`;
  return [
    {
      id: baseId,
      propertyId: PROPERTY,
      folioId: FOLIO,
      type: 'room',
      description: `Room tariff - ${date}`,
      amount: options.room ?? '100.00',
      taxAmount: '0.00',
      currencyCode: 'EUR',
      serviceDate: new Date(`${date}T00:00:00.000Z`),
      isReversal: false,
      originalChargeId: null,
      parentChargeId: null,
      sourceKey: `accepted-pricing:reservation:${RESERVATION}:night:${date}`,
      isLocked: options.locked ?? false,
    },
    {
      id: `tax-${suffix}`,
      propertyId: PROPERTY,
      folioId: FOLIO,
      type: 'tax',
      description: `Room tariff - ${date} tax`,
      amount: options.tax ?? '10.00',
      taxAmount: '0.00',
      currencyCode: 'EUR',
      serviceDate: new Date(`${date}T00:00:00.000Z`),
      isReversal: false,
      originalChargeId: null,
      parentChargeId: baseId,
      sourceKey: null,
      isLocked: options.locked ?? false,
    },
  ];
}

function makeTx(
  ledger: Array<Record<string, any>>,
  serviceRows: Array<Record<string, any>> = [],
  folioReservationId = RESERVATION,
) {
  const inserted: Array<Record<string, any>> = [];
  let selectCount = 0;
  const select = vi.fn(() => {
    const rows = selectCount++ === 0
      ? [{
        id: FOLIO,
        propertyId: PROPERTY,
        reservationId: folioReservationId,
        status: 'open',
        currencyCode: 'EUR',
      }]
      : selectCount === 2
        ? serviceRows
        : ledger;
    const chain: any = {
      from: vi.fn(() => chain),
      where: vi.fn(() => chain),
      for: vi.fn(async () => structuredClone(rows)),
      then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) =>
        Promise.resolve(structuredClone(rows)).then(resolve, reject),
    };
    return chain;
  });
  const insert = vi.fn(() => ({
    values: vi.fn((value: Record<string, any>) => ({
      returning: vi.fn(async () => {
        const row = { id: `inserted-${inserted.length + 1}`, ...structuredClone(value) };
        inserted.push(row);
        ledger.push(row);
        return [row];
      }),
    })),
  }));
  return { tx: { select, insert }, inserted };
}

function service() {
  return new FolioService({} as any, { emit: vi.fn() } as any, {} as any);
}

describe('FolioService accepted-pricing stay amendment reconciliation', () => {
  it('rejects a same-property folio linked to a different reservation', async () => {
    const { tx, inserted } = makeTx([], [], 'different-reservation');
    const folio = service();
    vi.spyOn(folio, 'recalculateBalance').mockResolvedValue(undefined);

    await expect(folio.reconcileAcceptedStayAmendment({
      tx,
      propertyId: PROPERTY,
      folioId: FOLIO,
      reservationId: RESERVATION,
      amendmentId: AMENDMENT,
      previousPricing: oldPricing,
      newPricing: oldPricing,
    })).rejects.toBeInstanceOf(ConflictException);
    expect(inserted).toEqual([]);
  });

  it('reverses only removed unlocked accepted groups and preserves overlapping revenue and extras', async () => {
    const ledger = [
      ...roomGroup('2026-10-01', 'one'),
      ...roomGroup('2026-10-02', 'two'),
      {
        id: 'minibar-1',
        propertyId: PROPERTY,
        folioId: FOLIO,
        type: 'minibar',
        description: 'Minibar',
        amount: '25.00',
        taxAmount: '0.00',
        currencyCode: 'EUR',
        serviceDate: new Date('2026-10-01T12:00:00.000Z'),
        isReversal: false,
        originalChargeId: null,
        parentChargeId: null,
        sourceKey: null,
        isLocked: false,
      },
    ];
    const nextPricing: AcceptedPricingSnapshot = {
      ...structuredClone(oldPricing),
      source: 'prior',
      grandTotal: '110.00',
      roomTotal: '100.00',
      taxTotal: '10.00',
      nights: [oldPricing.nights[0]!],
    };
    const { tx, inserted } = makeTx(ledger);
    const folio = service();
    vi.spyOn(folio, 'recalculateBalance').mockResolvedValue(undefined);

    const result = await folio.reconcileAcceptedStayAmendment({
      tx,
      propertyId: PROPERTY,
      folioId: FOLIO,
      reservationId: RESERVATION,
      amendmentId: AMENDMENT,
      previousPricing: oldPricing,
      newPricing: nextPricing,
      postedBy: 'staff-1',
    });

    expect(result).toEqual({
      reversedChargeIds: ['room-two'],
      adjustmentAmount: '0.00',
    });
    expect(inserted).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'room',
        amount: '-100.00',
        isReversal: true,
        originalChargeId: 'room-two',
      }),
      expect.objectContaining({
        type: 'tax',
        amount: '-10.00',
        isReversal: true,
        originalChargeId: 'tax-two',
      }),
    ]));
    expect(inserted.some((row) => row.originalChargeId === 'room-one')).toBe(false);
    expect(inserted.some((row) => row.originalChargeId === 'minibar-1')).toBe(false);
  });

  it('posts one linked delta for changed posted overlap and leaves future nights for night audit', async () => {
    const ledger = [...roomGroup('2026-10-01', 'one')];
    const nextPricing: AcceptedPricingSnapshot = {
      ...structuredClone(oldPricing),
      source: 'current',
      grandTotal: '264.00',
      roomTotal: '240.00',
      taxTotal: '24.00',
      nights: [
        { date: '2026-10-01', roomAmount: '120.00', taxAmount: '12.00' },
        { date: '2026-10-02', roomAmount: '120.00', taxAmount: '12.00' },
      ],
    };
    const { tx, inserted } = makeTx(ledger);
    const folio = service();
    vi.spyOn(folio, 'recalculateBalance').mockResolvedValue(undefined);

    const result = await folio.reconcileAcceptedStayAmendment({
      tx,
      propertyId: PROPERTY,
      folioId: FOLIO,
      reservationId: RESERVATION,
      amendmentId: AMENDMENT,
      previousPricing: oldPricing,
      newPricing: nextPricing,
      postedBy: 'staff-1',
    });

    expect(result).toEqual({ reversedChargeIds: [], adjustmentAmount: '22.00' });
    expect(inserted).toEqual([
      expect.objectContaining({
        type: 'adjustment',
        amount: '22.00',
        sourceKey: `accepted-pricing:reservation:${RESERVATION}:amendment:${AMENDMENT}:pricing-delta`,
      }),
    ]);
    expect(inserted.some((row) => row.type === 'room')).toBe(false);
  });

  it('accounts for prior amendment deltas instead of posting the same revenue twice', async () => {
    const ledger = [
      ...roomGroup('2026-10-01', 'one'),
      {
        id: 'prior-amendment-delta',
        propertyId: PROPERTY,
        folioId: FOLIO,
        type: 'adjustment',
        description: 'Accepted stay amendment pricing adjustment',
        amount: '22.00',
        taxAmount: '0.00',
        currencyCode: 'EUR',
        serviceDate: new Date('2026-10-01T00:00:00.000Z'),
        isReversal: false,
        originalChargeId: null,
        parentChargeId: null,
        sourceKey: `accepted-pricing:reservation:${RESERVATION}:amendment:prior-amendment:pricing-delta`,
        isLocked: false,
      },
    ];
    const nextPricing: AcceptedPricingSnapshot = {
      ...structuredClone(oldPricing),
      source: 'current',
      grandTotal: '264.00',
      roomTotal: '240.00',
      taxTotal: '24.00',
      nights: [
        { date: '2026-10-01', roomAmount: '120.00', taxAmount: '12.00' },
        { date: '2026-10-02', roomAmount: '120.00', taxAmount: '12.00' },
      ],
    };
    const { tx, inserted } = makeTx(ledger);
    const folio = service();
    vi.spyOn(folio, 'recalculateBalance').mockResolvedValue(undefined);

    const result = await folio.reconcileAcceptedStayAmendment({
      tx,
      propertyId: PROPERTY,
      folioId: FOLIO,
      reservationId: RESERVATION,
      amendmentId: AMENDMENT,
      previousPricing: oldPricing,
      newPricing: nextPricing,
    });

    expect(result).toEqual({ reversedChargeIds: [], adjustmentAmount: '0.00' });
    expect(inserted).toEqual([]);
  });

  it('preserves accepted service groups that do not belong to the amended reservation', async () => {
    const ledger = [
      ...roomGroup('2026-10-01', 'one'),
      {
        id: 'other-service-charge',
        propertyId: PROPERTY,
        folioId: FOLIO,
        type: 'service',
        description: 'Transferred accepted service',
        amount: '25.00',
        taxAmount: '0.00',
        currencyCode: 'EUR',
        serviceDate: new Date('2026-10-01T00:00:00.000Z'),
        isReversal: false,
        originalChargeId: null,
        parentChargeId: null,
        sourceKey: 'accepted-pricing:reservation-service:other-row:once',
        isLocked: false,
      },
    ];
    const nextPricing: AcceptedPricingSnapshot = {
      ...structuredClone(oldPricing),
      nights: [oldPricing.nights[0]!],
      roomTotal: '100.00',
      taxTotal: '10.00',
      grandTotal: '110.00',
    };
    const { tx, inserted } = makeTx(ledger);
    const folio = service();
    vi.spyOn(folio, 'recalculateBalance').mockResolvedValue(undefined);

    await folio.reconcileAcceptedStayAmendment({
      tx,
      propertyId: PROPERTY,
      folioId: FOLIO,
      reservationId: RESERVATION,
      amendmentId: AMENDMENT,
      previousPricing: oldPricing,
      newPricing: nextPricing,
    });

    expect(inserted.some((row) => row.originalChargeId === 'other-service-charge')).toBe(false);
  });

  it('uses the linked adjustment instead of reversing a locked removed group', async () => {
    const ledger = [...roomGroup('2026-10-02', 'two', { locked: true })];
    const nextPricing: AcceptedPricingSnapshot = {
      ...structuredClone(oldPricing),
      source: 'prior',
      grandTotal: '110.00',
      roomTotal: '100.00',
      taxTotal: '10.00',
      nights: [oldPricing.nights[0]!],
    };
    const { tx, inserted } = makeTx(ledger);
    const folio = service();
    vi.spyOn(folio, 'recalculateBalance').mockResolvedValue(undefined);

    const result = await folio.reconcileAcceptedStayAmendment({
      tx,
      propertyId: PROPERTY,
      folioId: FOLIO,
      reservationId: RESERVATION,
      amendmentId: AMENDMENT,
      previousPricing: oldPricing,
      newPricing: nextPricing,
      postedBy: 'staff-1',
    });

    expect(result).toEqual({ reversedChargeIds: [], adjustmentAmount: '-110.00' });
    expect(inserted).toEqual([
      expect.objectContaining({ type: 'adjustment', amount: '-110.00' }),
    ]);
  });
});
