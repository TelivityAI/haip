import type { AcceptedPricingSnapshot } from '@telivityhaip/database';
import { ConflictException } from '@nestjs/common';
import Decimal from 'decimal.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
      lockedByAuditDate: options.locked ? date : null,
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
      lockedByAuditDate: options.locked ? date : null,
    },
  ];
}

function makeTx(
  ledger: Array<Record<string, any>>,
  serviceRows: Array<Record<string, any>> = [],
  folioReservationId = RESERVATION,
  completedAudits: Array<{ businessDate: string }> = [],
  propertyTimezone = 'UTC',
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
      }], serviceRows, ledger, [{ id: PROPERTY, timezone: propertyTimezone }], completedAudits];
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
  afterEach(() => {
    vi.useRealTimers();
  });
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

  it('uses signed amendment rows for removed accepted groups and preserves extras', async () => {
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
      reversedChargeIds: [],
      adjustmentAmount: '-110.00',
    });
    expect(inserted).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'room',
        amount: '-100.00',
        isReversal: false,
        adjustsChargeId: 'room-two',
      }),
      expect.objectContaining({
        type: 'tax',
        amount: '-10.00',
        isReversal: false,
        adjustsChargeId: 'tax-two',
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
        adjustsChargeId: 'room-one',
        isReversal: false,
      }),
      expect.objectContaining({
        type: 'tax',
        amount: '2.00',
        parentChargeId: 'room-one',
        adjustsChargeId: 'tax-one',
        isReversal: false,
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
        sourceKey: 'accepted-pricing:reservation-service:other-row:once:2026-10-01',
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
    const ledger = [
      ...roomGroup('2026-10-01', 'one'),
      ...roomGroup('2026-10-02', 'two', { locked: true }),
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

    expect(result).toEqual({ reversedChargeIds: [], adjustmentAmount: '-110.00' });
    expect(inserted).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'room', amount: '-100.00', isReversal: false,
        adjustsChargeId: 'room-two', serviceDate: new Date('2026-10-03T00:00:00.000Z'),
      }),
      expect.objectContaining({
        type: 'tax', amount: '-10.00', isReversal: false,
        adjustsChargeId: 'tax-two', serviceDate: new Date('2026-10-03T00:00:00.000Z'),
      }),
    ]));
    expect(ledger.slice(2, 4).every((row) => row.isLocked)).toBe(true);
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
      sourceKey: 'accepted-pricing:reservation-service:rs-1:once:2026-10-01', isLocked: false,
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
      expect.objectContaining({
        type: 'parking', amount: '-15.00', isReversal: false,
        adjustsChargeId: 'service-one',
      }),
      expect.objectContaining({
        type: 'spa', amount: '20.00', isReversal: false,
        adjustsChargeId: 'service-one',
      }),
      expect.objectContaining({
        type: 'tax', amount: '1.00', isReversal: false,
        adjustsChargeId: 'service-tax',
      }),
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

  it('balances a partially posted per-night group and defers a future once group', async () => {
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

    const result = await folio.reconcileAcceptedStayAmendment({
      tx, propertyId: PROPERTY, folioId: FOLIO, reservationId: RESERVATION,
      amendmentId: AMENDMENT, previousPricing: oldPricing, newPricing: nextPricing,
    });

    expect(inserted).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'parking', amount: '-15.00', isReversal: false }),
      expect.objectContaining({ type: 'tax', amount: '-2.00', isReversal: false }),
    ]));
    expect(inserted.some((row) =>
      row.sourceKey === 'accepted-pricing:reservation-service:rs-1:once:2026-10-01')).toBe(false);
  });

  it('balances an old once date and recovers a reanchored closed once date exactly once', async () => {
    const serviceRow = {
      id: 'rs-1', propertyId: PROPERTY, reservationId: RESERVATION, serviceId: 'svc-1',
    };
    const oldBase = {
      id: 'service-old', propertyId: PROPERTY, folioId: FOLIO,
      type: 'parking', description: 'Parking [svc:rs-1]', amount: '20.00', taxAmount: '0.00',
      currencyCode: 'EUR', serviceDate: new Date('2026-10-01T00:00:00.000Z'),
      isReversal: false, originalChargeId: null, parentChargeId: null,
      sourceKey: 'accepted-pricing:reservation-service:rs-1:once:2026-10-01',
      isLocked: true, lockedByAuditDate: '2026-10-02',
    };
    const ledger = [oldBase, {
      ...oldBase, id: 'service-old-tax', type: 'tax', description: 'Parking tax', amount: '2.00',
      parentChargeId: oldBase.id, sourceKey: null,
    }];
    const reanchored: AcceptedPricingSnapshot = {
      ...structuredClone(oldPricing),
      nights: [], roomTotal: '0.00', taxTotal: '0.00',
      services: [{
        serviceId: 'svc-1', code: 'PARK', name: 'Parking', postingRule: 'once',
        chargeType: 'parking', currencyCode: 'EUR', unitPrice: '20.00', quantity: 1,
        lineTotal: '20.00', taxTotal: '2.00',
        lineItems: [{ date: '2026-10-02', amount: '20.00', taxAmount: '2.00' }],
      }],
      servicesTotal: '20.00', servicesTaxTotal: '2.00', grandTotal: '22.00',
    };
    const { tx, inserted } = makeTx(
      ledger, [serviceRow], RESERVATION, [{ businessDate: '2026-10-02' }],
    );
    const folio = service();
    vi.spyOn(folio, 'recalculateBalance').mockResolvedValue(undefined);

    const first = await folio.reconcileAcceptedStayAmendment({
      tx, propertyId: PROPERTY, folioId: FOLIO, reservationId: RESERVATION,
      amendmentId: AMENDMENT, previousPricing: oldPricing, newPricing: reanchored,
    });
    const count = inserted.length;
    const replay = await folio.reconcileAcceptedStayAmendment({
      tx, propertyId: PROPERTY, folioId: FOLIO, reservationId: RESERVATION,
      amendmentId: AMENDMENT, previousPricing: oldPricing, newPricing: reanchored,
    });

    expect(first.adjustmentAmount).toBe('0.00');
    expect(replay.adjustmentAmount).toBe('0.00');
    expect(inserted).toHaveLength(count);
    expect(inserted).toEqual(expect.arrayContaining([
      expect.objectContaining({
        amount: '-20.00', isReversal: false, adjustsChargeId: 'service-old',
        serviceDate: new Date('2026-10-03T00:00:00.000Z'),
      }),
      expect.objectContaining({
        amount: '-2.00', isReversal: false, adjustsChargeId: 'service-old-tax',
        serviceDate: new Date('2026-10-03T00:00:00.000Z'),
      }),
      expect.objectContaining({
        amount: '20.00',
        sourceKey: 'accepted-pricing:reservation-service:rs-1:once:2026-10-02',
        serviceDate: new Date('2026-10-03T00:00:00.000Z'),
      }),
    ]));
  });

  it('keeps repeated repricing oscillations as additive non-reversal history', async () => {
    const ledger = [...roomGroup('2026-10-01', 'one')];
    const { tx, inserted } = makeTx(ledger);
    const folio = service();
    vi.spyOn(folio, 'recalculateBalance').mockResolvedValue(undefined);
    const snapshot = (room: string, tax: string): AcceptedPricingSnapshot => ({
      ...structuredClone(oldPricing),
      nights: [{ date: '2026-10-01', roomAmount: room, taxAmount: tax }],
      roomTotal: room,
      taxTotal: tax,
      grandTotal: new Decimal(room).plus(tax).toFixed(2),
    });
    let prior = snapshot('100.00', '10.00');
    for (const [index, [room, tax]] of [
      ['120.00', '12.00'],
      ['80.00', '8.00'],
      ['100.00', '10.00'],
      ['70.00', '7.00'],
    ].entries()) {
      const next = snapshot(room, tax);
      await folio.reconcileAcceptedStayAmendment({
        tx, propertyId: PROPERTY, folioId: FOLIO, reservationId: RESERVATION,
        amendmentId: `amendment-${index + 1}`, previousPricing: prior, newPricing: next,
      });
      prior = next;
    }

    expect(inserted.every((row) => row.isReversal === false)).toBe(true);
    expect(inserted.every((row) => row.adjustsChargeId === 'room-one'
      || row.adjustsChargeId === 'tax-one')).toBe(true);
    const roomNet = ledger.filter((row) => row.type === 'room')
      .reduce((total, row) => total.plus(row.amount), new Decimal(0));
    const taxNet = ledger.filter((row) => row.type === 'tax')
      .reduce((total, row) => total.plus(row.amount), new Decimal(0));
    expect(roomNet.toFixed(2)).toBe('70.00');
    expect(taxNet.toFixed(2)).toBe('7.00');
  });

  it('keeps exact 100 to 120 to removed room and tax history additive', async () => {
    const ledger = [...roomGroup('2026-10-01', 'one')];
    const { tx, inserted } = makeTx(ledger);
    const folio = service();
    vi.spyOn(folio, 'recalculateBalance').mockResolvedValue(undefined);
    const snapshot = (room: string, tax: string): AcceptedPricingSnapshot => ({
      ...structuredClone(oldPricing),
      nights: room === '0.00' && tax === '0.00'
        ? []
        : [{ date: '2026-10-01', roomAmount: room, taxAmount: tax }],
      roomTotal: room,
      taxTotal: tax,
      grandTotal: new Decimal(room).plus(tax).toFixed(2),
    });
    const raised = snapshot('120.00', '12.00');
    await folio.reconcileAcceptedStayAmendment({
      tx, propertyId: PROPERTY, folioId: FOLIO, reservationId: RESERVATION,
      amendmentId: 'raise', previousPricing: snapshot('100.00', '10.00'), newPricing: raised,
    });
    await folio.reconcileAcceptedStayAmendment({
      tx, propertyId: PROPERTY, folioId: FOLIO, reservationId: RESERVATION,
      amendmentId: 'remove', previousPricing: raised, newPricing: snapshot('0.00', '0.00'),
    });

    expect(inserted.map((row) => [row.type, row.amount])).toEqual([
      ['room', '20.00'],
      ['tax', '2.00'],
      ['room', '-120.00'],
      ['tax', '-12.00'],
    ]);
    expect(ledger.reduce(
      (total, row) => total.plus(row.amount),
      new Decimal(0),
    ).toFixed(2)).toBe('0.00');
    expect(inserted.every((row) => row.isReversal === false)).toBe(true);
  });

  it('keeps a tax-only repricing correction separate from room revenue', async () => {
    const ledger = [...roomGroup('2026-10-01', 'one')];
    const { tx, inserted } = makeTx(ledger);
    const folio = service();
    vi.spyOn(folio, 'recalculateBalance').mockResolvedValue(undefined);
    const snapshot = (tax: string): AcceptedPricingSnapshot => ({
      ...structuredClone(oldPricing),
      nights: [{ date: '2026-10-01', roomAmount: '100.00', taxAmount: tax }],
      roomTotal: '100.00', taxTotal: tax,
      grandTotal: new Decimal(100).plus(tax).toFixed(2),
    });
    await folio.reconcileAcceptedStayAmendment({
      tx, propertyId: PROPERTY, folioId: FOLIO, reservationId: RESERVATION,
      amendmentId: 'tax-raise', previousPricing: snapshot('10.00'), newPricing: snapshot('12.00'),
    });
    await folio.reconcileAcceptedStayAmendment({
      tx, propertyId: PROPERTY, folioId: FOLIO, reservationId: RESERVATION,
      amendmentId: 'tax-drop', previousPricing: snapshot('12.00'), newPricing: snapshot('7.00'),
    });

    expect(inserted.map((row) => [row.type, row.amount, row.adjustsChargeId])).toEqual([
      ['tax', '2.00', 'tax-one'],
      ['tax', '-5.00', 'tax-one'],
    ]);
    expect(ledger.filter((row) => row.type === 'room')
      .reduce((total, row) => total.plus(row.amount), new Decimal(0)).toFixed(2)).toBe('100.00');
    expect(ledger.filter((row) => row.type === 'tax')
      .reduce((total, row) => total.plus(row.amount), new Decimal(0)).toFixed(2)).toBe('7.00');
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

    const result = await folio.reconcileAcceptedStayAmendment({
      tx, propertyId: PROPERTY, folioId: FOLIO, reservationId: RESERVATION,
      amendmentId: AMENDMENT, previousPricing: oldPricing, newPricing: oldPricing,
    });
    const count = inserted.length;
    await folio.reconcileAcceptedStayAmendment({
      tx, propertyId: PROPERTY, folioId: FOLIO, reservationId: RESERVATION,
      amendmentId: AMENDMENT, previousPricing: oldPricing, newPricing: oldPricing,
    });

    expect(inserted).toHaveLength(count);
    expect(result).toEqual({ reversedChargeIds: [], adjustmentAmount: '110.00' });
    expect(inserted).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'room', amount: '100.00',
        sourceKey: `accepted-pricing:reservation:${RESERVATION}:night:2026-10-02`,
        serviceDate: new Date('2026-10-03T00:00:00.000Z'),
      }),
      expect.objectContaining({
        type: 'tax', amount: '10.00', serviceDate: new Date('2026-10-03T00:00:00.000Z'),
      }),
    ]));
  });

  it('does not duplicate a closed accepted service across a cancelled row and an active duplicate', async () => {
    const acceptedService = {
      serviceId: 'svc-1', code: 'PARK', name: 'Parking', postingRule: 'once' as const,
      chargeType: 'parking', currencyCode: 'EUR', unitPrice: '20.00', quantity: 1,
      lineTotal: '20.00', taxTotal: '2.00',
      lineItems: [{ date: '2026-10-02', amount: '20.00', taxAmount: '2.00' }],
    };
    const pricing: AcceptedPricingSnapshot = {
      version: 1, source: 'current', currencyCode: 'EUR', grandTotal: '22.00',
      roomTotal: '0.00', taxTotal: '0.00', nights: [], services: [acceptedService],
      servicesTotal: '20.00', servicesTaxTotal: '2.00', customReason: null, adjustment: null,
    };
    const serviceRows = [{
      id: 'rs-accepted-cancelled', propertyId: PROPERTY, reservationId: RESERVATION,
      serviceId: 'svc-1', status: 'cancelled', sourceChannel: 'booking_engine',
      createdAt: new Date('2026-08-24T10:05:00.000Z'),
    }, {
      id: 'rs-frontdesk-active', propertyId: PROPERTY, reservationId: RESERVATION,
      serviceId: 'svc-1', status: 'confirmed', sourceChannel: 'front_desk',
      createdAt: new Date('2026-08-25T10:05:00.000Z'),
    }];
    const manualExtra = {
      id: 'manual-extra', propertyId: PROPERTY, folioId: FOLIO,
      type: 'parking', description: 'Front desk parking [svc:rs-frontdesk-active]',
      amount: '27.00', taxAmount: '0.00', currencyCode: 'EUR',
      serviceDate: new Date('2026-10-02T00:00:00.000Z'), isReversal: false,
      originalChargeId: null, parentChargeId: null, sourceKey: null, isLocked: true,
    };
    const ledger: Array<Record<string, any>> = [manualExtra];
    const { tx, inserted } = makeTx(
      ledger,
      serviceRows,
      RESERVATION,
      [{ businessDate: '2026-10-02' }],
    );
    const folio = service();
    vi.spyOn(folio, 'recalculateBalance').mockResolvedValue(undefined);

    await folio.reconcileAcceptedStayAmendment({
      tx, propertyId: PROPERTY, folioId: FOLIO, reservationId: RESERVATION,
      amendmentId: AMENDMENT, previousPricing: pricing, newPricing: pricing,
    });

    expect(inserted.filter((row) => row.sourceKey?.includes('reservation-service'))).toEqual([]);
    expect(ledger).toContain(manualExtra);
    expect(inserted.some((row) => row.adjustsChargeId === manualExtra.id)).toBe(false);
  });

  it('posts a correction on the property-local open date across a UTC boundary without a completed audit', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-02T01:00:00.000Z'));
    const oldNight: AcceptedPricingSnapshot = {
      ...structuredClone(oldPricing),
      grandTotal: '110.00', roomTotal: '100.00', taxTotal: '10.00',
      nights: [{ date: '2026-09-30', roomAmount: '100.00', taxAmount: '10.00' }],
    };
    const next: AcceptedPricingSnapshot = {
      ...structuredClone(oldNight), grandTotal: '0.00', roomTotal: '0.00', taxTotal: '0.00', nights: [],
    };
    const ledger = roomGroup('2026-09-30', 'timezone', { locked: true });
    ledger.forEach((row) => { row.lockedByAuditDate = null; });
    const { tx, inserted } = makeTx(
      ledger,
      [],
      RESERVATION,
      [],
      'America/Los_Angeles',
    );
    const folio = service();
    vi.spyOn(folio, 'recalculateBalance').mockResolvedValue(undefined);

    await folio.reconcileAcceptedStayAmendment({
      tx, propertyId: PROPERTY, folioId: FOLIO, reservationId: RESERVATION,
      amendmentId: AMENDMENT, previousPricing: oldNight, newPricing: next,
    });

    expect(inserted).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'room', amount: '-100.00', serviceDate: new Date('2026-10-01T00:00:00.000Z'),
      }),
    ]));
  });

  it('uses the actual property-local date when the last completed audit is delayed', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-01T12:30:00.000Z'));
    const oldNight: AcceptedPricingSnapshot = {
      ...structuredClone(oldPricing),
      grandTotal: '110.00', roomTotal: '100.00', taxTotal: '10.00',
      nights: [{ date: '2026-09-20', roomAmount: '100.00', taxAmount: '10.00' }],
    };
    const next: AcceptedPricingSnapshot = {
      ...structuredClone(oldNight), grandTotal: '0.00', roomTotal: '0.00', taxTotal: '0.00', nights: [],
    };
    const ledger = roomGroup('2026-09-20', 'delayed');
    const { tx, inserted } = makeTx(
      ledger,
      [],
      RESERVATION,
      [{ businessDate: '2026-09-20' }],
      'Pacific/Kiritimati',
    );
    const folio = service();
    vi.spyOn(folio, 'recalculateBalance').mockResolvedValue(undefined);

    await folio.reconcileAcceptedStayAmendment({
      tx, propertyId: PROPERTY, folioId: FOLIO, reservationId: RESERVATION,
      amendmentId: AMENDMENT, previousPricing: oldNight, newPricing: next,
    });

    expect(inserted).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'room', amount: '-100.00', serviceDate: new Date('2026-10-02T00:00:00.000Z'),
      }),
    ]));
  });

  it('links removal of a negative custom component to that exact component on a closed date', async () => {
    const ledger = roomGroup('2026-10-02', 'custom', { locked: true });
    ledger.push({
      ...ledger[0],
      id: 'custom-discount',
      type: 'adjustment',
      description: 'Accepted price adjustment: loyalty discount',
      amount: '-20.00',
      parentChargeId: 'room-custom',
      sourceKey: null,
    });
    const previous: AcceptedPricingSnapshot = {
      ...structuredClone(oldPricing),
      grandTotal: '90.00', roomTotal: '100.00', taxTotal: '10.00',
      nights: [{ date: '2026-10-02', roomAmount: '100.00', taxAmount: '10.00' }],
      adjustment: {
        amount: '-20.00', reason: 'loyalty discount', serviceDate: '2026-10-02',
      },
    };
    const next: AcceptedPricingSnapshot = {
      ...structuredClone(previous), grandTotal: '110.00', adjustment: null,
    };
    const { tx, inserted } = makeTx(ledger);
    const folio = service();
    vi.spyOn(folio, 'recalculateBalance').mockResolvedValue(undefined);

    await folio.reconcileAcceptedStayAmendment({
      tx, propertyId: PROPERTY, folioId: FOLIO, reservationId: RESERVATION,
      amendmentId: AMENDMENT, previousPricing: previous, newPricing: next,
    });

    expect(inserted).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'adjustment',
        amount: '20.00',
        adjustsChargeId: 'custom-discount',
        serviceDate: new Date('2026-10-03T00:00:00.000Z'),
        description: expect.stringContaining('affected 2026-10-02'),
      }),
    ]));
  });
});
