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
  completedAudits: Array<{ businessDate: string }> = [],
) {
  const inserted: Array<Record<string, any>> = [];
  let selectCount = 0;
  const select = vi.fn(() => {
    const stages = [[{
        id: FOLIO,
        propertyId: PROPERTY,
        reservationId: folioReservationId,
        status: 'open',
        currencyCode: 'EUR',
      }], serviceRows, ledger, completedAudits];
    const rows = stages[selectCount++ % stages.length]!;
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

  it('posts separate room and tax corrections for changed overlap and leaves future nights for night audit', async () => {
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
        type: 'room',
        amount: '20.00',
        parentChargeId: 'room-one',
      }),
      expect.objectContaining({
        type: 'tax',
        amount: '2.00',
        parentChargeId: 'room-one',
      }),
    ]);
    expect(inserted.some((row) => row.type === 'adjustment')).toBe(false);
  });

  it('replays component corrections without posting the same revenue twice', async () => {
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

    const first = await folio.reconcileAcceptedStayAmendment({
      tx,
      propertyId: PROPERTY,
      folioId: FOLIO,
      reservationId: RESERVATION,
      amendmentId: AMENDMENT,
      previousPricing: oldPricing,
      newPricing: nextPricing,
    });
    const insertedAfterFirst = inserted.length;
    const replay = await folio.reconcileAcceptedStayAmendment({
      tx,
      propertyId: PROPERTY,
      folioId: FOLIO,
      reservationId: RESERVATION,
      amendmentId: AMENDMENT,
      previousPricing: oldPricing,
      newPricing: nextPricing,
    });

    expect(first).toEqual({ reversedChargeIds: [], adjustmentAmount: '22.00' });
    expect(replay).toEqual({ reversedChargeIds: [], adjustmentAmount: '0.00' });
    expect(inserted).toHaveLength(insertedAfterFirst);
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

  it('preserves room and tax attribution when correcting a locked removed group', async () => {
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
      expect.objectContaining({ type: 'room', amount: '-100.00', isReversal: true }),
      expect.objectContaining({ type: 'tax', amount: '-10.00', isReversal: true }),
    ]);
  });

  it('reconciles a service charge-type and tax change by category', async () => {
    const serviceRow = {
      id: 'rs-1', propertyId: PROPERTY, reservationId: RESERVATION, serviceId: 'svc-1',
    };
    const serviceBase = {
      id: 'service-one', propertyId: PROPERTY, folioId: FOLIO,
      type: 'parking', description: 'Parking [svc:rs-1]', amount: '15.00', taxAmount: '0.00',
      currencyCode: 'EUR', serviceDate: new Date('2026-10-01T00:00:00.000Z'),
      isReversal: false, originalChargeId: null, parentChargeId: null,
      sourceKey: 'accepted-pricing:reservation-service:rs-1:once', isLocked: false,
    };
    const ledger = [serviceBase, {
      ...serviceBase,
      id: 'service-tax',
      type: 'tax',
      description: 'Parking tax',
      amount: '2.00',
      parentChargeId: 'service-one',
      sourceKey: null,
    }];
    const nextPricing: AcceptedPricingSnapshot = {
      ...structuredClone(oldPricing),
      services: [{
        serviceId: 'svc-1', code: 'PARK', name: 'Parking', postingRule: 'once',
        chargeType: 'spa', currencyCode: 'EUR', unitPrice: '20.00', quantity: 1,
        lineTotal: '20.00', taxTotal: '3.00',
        lineItems: [{ date: '2026-10-01', amount: '20.00', taxAmount: '3.00' }],
      }],
      servicesTotal: '20.00',
      servicesTaxTotal: '3.00',
      grandTotal: '243.00',
    };
    const { tx, inserted } = makeTx(ledger, [serviceRow]);
    const folio = service();
    vi.spyOn(folio, 'recalculateBalance').mockResolvedValue(undefined);

    const result = await folio.reconcileAcceptedStayAmendment({
      tx, propertyId: PROPERTY, folioId: FOLIO, reservationId: RESERVATION,
      amendmentId: AMENDMENT, previousPricing: oldPricing, newPricing: nextPricing,
    });

    expect(result.adjustmentAmount).toBe('6.00');
    expect(inserted).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'parking', amount: '-15.00', isReversal: true }),
      expect.objectContaining({ type: 'spa', amount: '20.00', isReversal: false }),
      expect.objectContaining({ type: 'tax', amount: '1.00' }),
    ]));
  });

  it('rejects an accepted automatic service without an operational reservation-service row', async () => {
    const nextPricing: AcceptedPricingSnapshot = {
      ...structuredClone(oldPricing),
      services: [{
        serviceId: 'missing-service', code: 'MISS', name: 'Missing', postingRule: 'once',
        chargeType: 'fee', currencyCode: 'EUR', unitPrice: '20.00', quantity: 1,
        lineTotal: '20.00', taxTotal: '2.00',
        lineItems: [{ date: '2026-10-01', amount: '20.00', taxAmount: '2.00' }],
      }],
      servicesTotal: '20.00',
      servicesTaxTotal: '2.00',
      grandTotal: '242.00',
    };
    const { tx, inserted } = makeTx([]);
    const folio = service();
    vi.spyOn(folio, 'recalculateBalance').mockResolvedValue(undefined);

    await expect(folio.reconcileAcceptedStayAmendment({
      tx, propertyId: PROPERTY, folioId: FOLIO, reservationId: RESERVATION,
      amendmentId: AMENDMENT, previousPricing: oldPricing, newPricing: nextPricing,
    })).rejects.toBeInstanceOf(ConflictException);
    expect(inserted).toEqual([]);
  });

  it('reverses a partially posted per-night service and posts the chosen once group immediately', async () => {
    const serviceRow = {
      id: 'rs-1', propertyId: PROPERTY, reservationId: RESERVATION, serviceId: 'svc-1',
    };
    const nightlyBase = {
      id: 'nightly-service', propertyId: PROPERTY, folioId: FOLIO,
      type: 'parking', description: 'Parking [svc:rs-1]', amount: '15.00', taxAmount: '0.00',
      currencyCode: 'EUR', serviceDate: new Date('2026-10-01T00:00:00.000Z'),
      isReversal: false, originalChargeId: null, parentChargeId: null,
      sourceKey: 'accepted-pricing:reservation-service:rs-1:night:2026-10-01', isLocked: false,
    };
    const ledger = [nightlyBase, {
      ...nightlyBase, id: 'nightly-tax', type: 'tax', description: 'Parking tax',
      amount: '2.00', parentChargeId: nightlyBase.id, sourceKey: null,
    }];
    const nextPricing: AcceptedPricingSnapshot = {
      ...structuredClone(oldPricing),
      services: [{
        serviceId: 'svc-1', code: 'PARK', name: 'Parking', postingRule: 'once',
        chargeType: 'parking', currencyCode: 'EUR', unitPrice: '25.00', quantity: 1,
        lineTotal: '25.00', taxTotal: '3.00',
        lineItems: [{ date: '2026-10-01', amount: '25.00', taxAmount: '3.00' }],
      }],
      servicesTotal: '25.00', servicesTaxTotal: '3.00', grandTotal: '248.00',
    };
    const { tx, inserted } = makeTx(ledger, [serviceRow]);
    const folio = service();
    vi.spyOn(folio, 'recalculateBalance').mockResolvedValue(undefined);

    await folio.reconcileAcceptedStayAmendment({
      tx, propertyId: PROPERTY, folioId: FOLIO, reservationId: RESERVATION,
      amendmentId: AMENDMENT, previousPricing: oldPricing, newPricing: nextPricing,
    });

    expect(inserted).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'parking', amount: '-15.00', isReversal: true }),
      expect.objectContaining({ type: 'tax', amount: '-2.00', isReversal: true }),
      expect.objectContaining({
        type: 'parking', amount: '25.00',
        sourceKey: 'accepted-pricing:reservation-service:rs-1:once',
      }),
      expect.objectContaining({ type: 'tax', amount: '3.00' }),
    ]));
  });

  it('posts a newly added closed night immediately with its canonical source and replays cleanly', async () => {
    const ledger = [...roomGroup('2026-10-01', 'one')];
    const { tx, inserted } = makeTx(
      ledger,
      [],
      RESERVATION,
      [{ businessDate: '2026-10-02' }],
    );
    const folio = service();
    vi.spyOn(folio, 'recalculateBalance').mockResolvedValue(undefined);

    await folio.reconcileAcceptedStayAmendment({
      tx, propertyId: PROPERTY, folioId: FOLIO, reservationId: RESERVATION,
      amendmentId: AMENDMENT, previousPricing: oldPricing, newPricing: oldPricing,
    });
    const count = inserted.length;
    await folio.reconcileAcceptedStayAmendment({
      tx, propertyId: PROPERTY, folioId: FOLIO, reservationId: RESERVATION,
      amendmentId: AMENDMENT, previousPricing: oldPricing, newPricing: oldPricing,
    });

    expect(inserted).toHaveLength(count);
    expect(inserted).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'room', amount: '100.00',
        sourceKey: `accepted-pricing:reservation:${RESERVATION}:night:2026-10-02`,
      }),
      expect.objectContaining({ type: 'tax', amount: '10.00' }),
    ]));
  });
});
