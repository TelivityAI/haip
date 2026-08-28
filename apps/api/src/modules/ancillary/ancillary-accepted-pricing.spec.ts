import { describe, expect, it, vi } from 'vitest';
import { reservations } from '@telivityhaip/database';
import { AncillaryService } from './ancillary.service';
import { WebhookService } from '../webhook/webhook.service';

function stagedSelect(stages: any[][]) {
  let index = 0;
  const select: any = vi.fn((selection?: Record<string, unknown>) => {
    const reservationMutex = selection?.id === reservations.id;
    const rows = reservationMutex ? [{ id: 'res-1' }] : stages[index++] ?? [];
    const promise = Promise.resolve(rows);
    const chain: any = {
      from: vi.fn(() => chain),
      innerJoin: vi.fn(() => chain),
      where: vi.fn(() => chain),
      for: vi.fn(async () => {
        if (reservationMutex) select.reservationLockCount++;
        return rows;
      }),
      limit: vi.fn(() => promise),
      then: promise.then.bind(promise),
    };
    return chain;
  });
  select.reservationLockCount = 0;
  return select;
}

function transactionalDb<T extends Record<string, any>>(db: T): T {
  db.execute = vi.fn(async () => undefined);
  db.transaction = vi.fn(async (work: (tx: T) => Promise<unknown>) => work(db));
  return db;
}

function recordedWebhookService() {
  const audits: Record<string, unknown>[] = [];
  const eventEmitter = { emit: vi.fn() };
  const webhook = new WebhookService({
    insert: vi.fn(() => ({
      values: vi.fn(async (row: Record<string, unknown>) => {
        audits.push(row);
      }),
    })),
  } as any, eventEmitter as any);
  return { webhook, eventEmitter, audits };
}

function idempotentSnapshotPoster(hasExistingGroup = false) {
  const ledgerGroups: Array<{ base: { id: string }; tax: { id: string } }> = [];
  if (hasExistingGroup) {
    ledgerGroups.push({
      base: { id: 'charge-1' },
      tax: { id: 'tax-1' },
    });
  }
  const postChargeFromSnapshotWithOutcome = vi.fn(async () => {
    const wasCreated = ledgerGroups.length === 0;
    if (wasCreated) {
      ledgerGroups.push({
        base: { id: 'charge-1' },
        tax: { id: 'tax-1' },
      });
    }
    return { charge: ledgerGroups[0].base, wasCreated };
  });
  return {
    ledgerGroups,
    folio: {
      postCharge: vi.fn(),
      postChargeFromSnapshotWithOutcome,
      postChargeFromSnapshot: vi.fn(async (...args: unknown[]) =>
        (await postChargeFromSnapshotWithOutcome(...args)).charge),
      emitSnapshotChargeWebhooks: vi.fn(),
    },
  };
}

function acceptedOnceScenario() {
  const reservation = {
    id: 'res-1',
    propertyId: 'prop-1',
    guestId: 'guest-1',
    arrivalDate: '2026-10-01',
    acceptedPricingSnapshot: {
      currencyCode: 'EUR',
      services: [{
        serviceId: 'svc-1',
        postingRule: 'once',
        chargeType: 'parking',
        lineItems: [{ date: '2026-10-01', amount: '15.00', taxAmount: '2.00' }],
      }],
    },
  };
  const rs = {
    id: 'rs-1',
    propertyId: 'prop-1',
    reservationId: 'res-1',
    serviceId: 'svc-1',
    unitPrice: '99.00',
    quantity: 1,
    chargeType: 'parking',
    currencyCode: 'EUR',
    postingRule: 'once',
    status: 'confirmed',
  };
  let status = 'confirmed';
  const casReturning = vi.fn(async () => {
    if (status !== 'confirmed') return [];
    status = 'posted';
    return [{ ...rs, status }];
  });
  const update = vi.fn(() => ({
    set: vi.fn(() => ({
      where: vi.fn(() => ({ returning: casReturning })),
    })),
  }));
  let transactionQueue = Promise.resolve();
  const createDb = () => {
    const db: any = {
      execute: vi.fn(async () => undefined),
      select: vi.fn(),
      update,
    };
    db.transaction = vi.fn(async (work: (tx: any) => Promise<unknown>) => {
      const previous = transactionQueue;
      let release!: () => void;
      transactionQueue = new Promise<void>((resolve) => { release = resolve; });
      await previous;
      db.select = stagedSelect([
        [reservation],
        [{ id: 'folio-1' }],
        [{ rs: { ...rs, status }, serviceName: 'Parking' }],
      ]);
      try {
        return await work(db);
      } finally {
        release();
      }
    });
    return db;
  };
  return { createDb, update, casReturning };
}

describe('AncillaryService accepted operational pricing', () => {
  it('skips frozen once posting while allowing an active manual duplicate', async () => {
    const reservation = {
      id: 'res-1', propertyId: 'prop-1', guestId: 'guest-1', arrivalDate: '2026-10-01',
      acceptedPricingSnapshot: {
        currencyCode: 'EUR',
        services: [{
          serviceId: 'svc-1', postingRule: 'once', chargeType: 'parking',
          lineItems: [{ date: '2026-10-01', amount: '15.00', taxAmount: '2.00' }],
        }],
      },
    };
    const cancelled = {
      id: 'rs-accepted', serviceId: 'svc-1', status: 'cancelled', postingRule: 'once',
      chargeType: 'parking', unitPrice: '15.00', quantity: 1, currencyCode: 'EUR',
      sourceChannel: 'booking_engine', createdAt: new Date('2026-08-24T10:00:00Z'),
    };
    const active = {
      ...cancelled, id: 'rs-frontdesk', status: 'confirmed', sourceChannel: 'front_desk',
      createdAt: new Date('2026-08-25T10:00:00Z'),
    };
    const db = transactionalDb({
      select: stagedSelect([
        [reservation], [{ id: 'folio-1' }],
        [{ rs: cancelled, serviceName: 'Parking' }, { rs: active, serviceName: 'Parking' }], [],
      ]),
      update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(() => ({
        returning: vi.fn(async () => [{ ...active, status: 'posted' }]),
      })) })) })),
    });
    const folio = {
      postCharge: vi.fn().mockResolvedValue({ id: 'manual-charge', taxCharges: [] }),
      postChargeFromSnapshotWithOutcome: vi.fn(),
      emitSnapshotChargeWebhooks: vi.fn(),
    };
    const service = new AncillaryService(db as any, folio as any, { emit: vi.fn() } as any);

    await expect(service.postOnceForReservation('res-1', 'prop-1'))
      .resolves.toMatchObject({ count: 1 });
    expect(folio.postChargeFromSnapshotWithOutcome).not.toHaveBeenCalled();
  });

  it('posts a manual once extra independently when the accepted duplicate is cancelled', async () => {
    const reservation = {
      id: 'res-1', propertyId: 'prop-1', guestId: 'guest-1', arrivalDate: '2026-10-01',
      acceptedPricingSnapshot: {
        currencyCode: 'EUR', services: [{
          serviceId: 'svc-1', postingRule: 'once', chargeType: 'parking',
          lineItems: [{ date: '2026-10-01', amount: '15.00', taxAmount: '2.00' }],
        }],
      },
    };
    const accepted = {
      id: 'rs-accepted', serviceId: 'svc-1', status: 'cancelled', postingRule: 'once',
      chargeType: 'parking', unitPrice: '15.00', quantity: 1, currencyCode: 'EUR',
      sourceChannel: 'booking_engine', createdAt: new Date('2026-08-24T10:00:00Z'),
    };
    const manual = {
      ...accepted, id: 'rs-manual', status: 'confirmed', sourceChannel: 'front_desk',
      unitPrice: '27.00', createdAt: new Date('2026-08-25T10:00:00Z'),
    };
    const db = transactionalDb({
      select: stagedSelect([
        [reservation], [{ id: 'folio-1' }],
        [{ rs: accepted, serviceName: 'Parking' }, { rs: manual, serviceName: 'Parking' }],
        [],
      ]),
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({ returning: vi.fn(async () => [{ ...manual, status: 'posted' }]) })),
        })),
      })),
    });
    const folio = {
      postCharge: vi.fn().mockResolvedValue({ id: 'manual-charge', taxCharges: [] }),
      postChargeFromSnapshotWithOutcome: vi.fn(), emitSnapshotChargeWebhooks: vi.fn(),
    };
    const service = new AncillaryService(db as any, folio as any, { emit: vi.fn() } as any);

    await expect(service.postOnceForReservation('res-1', 'prop-1'))
      .resolves.toMatchObject({ count: 1 });
    expect(folio.postCharge).toHaveBeenCalledWith(
      'folio-1', expect.objectContaining({ amount: '27.00' }), expect.anything(),
    );
    expect(folio.postChargeFromSnapshotWithOutcome).not.toHaveBeenCalled();
  });

  it('posts accepted and manual once rows independently at frozen and live amounts', async () => {
    const reservation = {
      id: 'res-1', propertyId: 'prop-1', guestId: 'guest-1', arrivalDate: '2026-10-01',
      acceptedPricingSnapshot: {
        currencyCode: 'EUR', services: [{
          serviceId: 'svc-1', postingRule: 'once', chargeType: 'parking',
          lineItems: [{ date: '2026-10-01', amount: '15.00', taxAmount: '2.00' }],
        }],
      },
    };
    const accepted = {
      id: 'rs-accepted', serviceId: 'svc-1', status: 'confirmed', postingRule: 'once',
      chargeType: 'parking', unitPrice: '99.00', quantity: 1, currencyCode: 'EUR',
      sourceChannel: 'booking_engine', createdAt: new Date('2026-08-24T10:00:00Z'),
    };
    const manual = {
      ...accepted, id: 'rs-manual', sourceChannel: 'front_desk', unitPrice: '27.00',
      createdAt: new Date('2026-08-25T10:00:00Z'),
    };
    const db = transactionalDb({
      select: stagedSelect([
        [reservation], [{ id: 'folio-1' }],
        [{ rs: accepted, serviceName: 'Parking' }, { rs: manual, serviceName: 'Parking' }],
        [],
      ]),
      update: vi.fn(() => ({ set: vi.fn(() => ({
        where: vi.fn(() => ({ returning: vi.fn(async () => [{ status: 'posted' }]) })),
      })) })),
    });
    const folio = {
      postCharge: vi.fn().mockResolvedValue({ id: 'manual-charge', taxCharges: [] }),
      postChargeFromSnapshotWithOutcome: vi.fn().mockResolvedValue({
        charge: { id: 'accepted-charge' }, wasCreated: true,
      }),
      emitSnapshotChargeWebhooks: vi.fn(),
    };
    const service = new AncillaryService(db as any, folio as any, { emit: vi.fn() } as any);

    await expect(service.postOnceForReservation('res-1', 'prop-1'))
      .resolves.toMatchObject({ count: 2 });
    expect(folio.postChargeFromSnapshotWithOutcome).toHaveBeenCalledWith(
      'folio-1', expect.objectContaining({ amount: '15.00' }), '2.00', undefined,
      'accepted-pricing:reservation-service:rs-accepted:once:2026-10-01', expect.anything(),
    );
    expect(folio.postCharge).toHaveBeenCalledWith(
      'folio-1', expect.objectContaining({ amount: '27.00' }), expect.anything(),
    );
  });

  it('posts a manual per-night extra independently of a cancelled accepted duplicate', async () => {
    const reservation = {
      id: 'res-1', propertyId: 'prop-1', guestId: 'guest-1', status: 'checked_in',
      acceptedPricingSnapshot: { currencyCode: 'EUR', services: [{
        serviceId: 'svc-1', postingRule: 'per_night', chargeType: 'parking',
        lineItems: [{ date: '2026-10-02', amount: '15.00', taxAmount: '2.00' }],
      }] },
    };
    const accepted = {
      id: 'rs-accepted', propertyId: 'prop-1', reservationId: 'res-1', serviceId: 'svc-1',
      status: 'cancelled', postingRule: 'per_night', chargeType: 'parking',
      unitPrice: '15.00', quantity: 1, currencyCode: 'EUR', sourceChannel: 'booking_engine',
      createdAt: new Date('2026-08-24T10:00:00Z'),
    };
    const manual = {
      ...accepted, id: 'rs-manual', status: 'confirmed', sourceChannel: 'front_desk',
      unitPrice: '27.00', createdAt: new Date('2026-08-25T10:00:00Z'),
    };
    const candidates = [
      { rs: accepted, serviceName: 'Parking', reservation },
      { rs: manual, serviceName: 'Parking', reservation },
    ];
    const db = transactionalDb({
      select: stagedSelect([candidates, candidates, candidates, [{ id: 'folio-1' }], []]),
    });
    const folio = {
      postCharge: vi.fn().mockResolvedValue({ id: 'manual-charge', taxCharges: [] }),
      postChargeFromSnapshotWithOutcome: vi.fn(), emitSnapshotChargeWebhooks: vi.fn(),
    };
    const service = new AncillaryService(db as any, folio as any, { emit: vi.fn() } as any);

    const result = await service.postPerNightForProperty('prop-1', '2026-10-02');

    expect(result.posted).toEqual([
      { reservationServiceId: 'rs-manual', chargeId: 'manual-charge', amount: '27.00' },
    ]);
    expect(folio.postCharge).toHaveBeenCalledOnce();
    expect(folio.postChargeFromSnapshotWithOutcome).not.toHaveBeenCalled();
  });

  it('posts accepted and manual per-night rows independently', async () => {
    const reservation = {
      id: 'res-1', propertyId: 'prop-1', guestId: 'guest-1', status: 'checked_in',
      acceptedPricingSnapshot: { currencyCode: 'EUR', services: [{
        serviceId: 'svc-1', postingRule: 'per_night', chargeType: 'parking',
        lineItems: [{ date: '2026-10-02', amount: '15.00', taxAmount: '2.00' }],
      }] },
    };
    const accepted = {
      id: 'rs-accepted', propertyId: 'prop-1', reservationId: 'res-1', serviceId: 'svc-1',
      status: 'confirmed', postingRule: 'per_night', chargeType: 'parking',
      unitPrice: '99.00', quantity: 1, currencyCode: 'EUR', sourceChannel: 'booking_engine',
      createdAt: new Date('2026-08-24T10:00:00Z'),
    };
    const manual = {
      ...accepted, id: 'rs-manual', sourceChannel: 'front_desk', unitPrice: '27.00',
      createdAt: new Date('2026-08-25T10:00:00Z'),
    };
    const candidates = [
      { rs: accepted, serviceName: 'Parking', reservation },
      { rs: manual, serviceName: 'Parking', reservation },
    ];
    const db = transactionalDb({
      select: stagedSelect([
        candidates, candidates, [{ id: 'folio-1' }],
        candidates, [{ id: 'folio-1' }], [],
      ]),
    });
    const folio = {
      postCharge: vi.fn().mockResolvedValue({ id: 'manual-charge', taxCharges: [] }),
      postChargeFromSnapshotWithOutcome: vi.fn().mockResolvedValue({
        charge: { id: 'accepted-charge' }, wasCreated: true,
      }), emitSnapshotChargeWebhooks: vi.fn(),
    };
    const service = new AncillaryService(db as any, folio as any, { emit: vi.fn() } as any);

    const result = await service.postPerNightForProperty('prop-1', '2026-10-02');

    expect(result.posted).toEqual(expect.arrayContaining([
      { reservationServiceId: 'rs-accepted', chargeId: 'accepted-charge', amount: '15.00' },
      { reservationServiceId: 'rs-manual', chargeId: 'manual-charge', amount: '27.00' },
    ]));
    expect(folio.postChargeFromSnapshotWithOutcome).toHaveBeenCalledOnce();
    expect(folio.postCharge).toHaveBeenCalledOnce();
  });

  it('never resurrects a cancelled accepted once service', async () => {
    const reservation = {
      id: 'res-1', propertyId: 'prop-1', guestId: 'guest-1', arrivalDate: '2026-10-01',
      acceptedPricingSnapshot: {
        currencyCode: 'EUR',
        services: [{
          serviceId: 'svc-1', postingRule: 'once', chargeType: 'parking',
          lineItems: [{ date: '2026-10-01', amount: '15.00', taxAmount: '2.00' }],
        }],
      },
    };
    const rs = {
      id: 'rs-1', serviceId: 'svc-1', status: 'cancelled', postingRule: 'once',
      chargeType: 'parking', unitPrice: '15.00', quantity: 1, currencyCode: 'EUR',
    };
    const db = transactionalDb({
      select: stagedSelect([[reservation], [{ id: 'folio-1' }], [{ rs, serviceName: 'Parking' }]]),
      update: vi.fn(),
    });
    const folio = {
      postCharge: vi.fn(), postChargeFromSnapshotWithOutcome: vi.fn(),
      emitSnapshotChargeWebhooks: vi.fn(),
    };
    const service = new AncillaryService(db as any, folio as any, { emit: vi.fn() } as any);

    await expect(service.postOnceForReservation('res-1', 'prop-1'))
      .resolves.toEqual({ posted: [], count: 0 });
    expect(folio.postChargeFromSnapshotWithOutcome).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });

  it('never resurrects a cancelled accepted per-night service after the candidate read', async () => {
    const reservation = {
      id: 'res-1', propertyId: 'prop-1', guestId: 'guest-1', status: 'checked_in',
      acceptedPricingSnapshot: {
        currencyCode: 'EUR',
        services: [{
          serviceId: 'svc-1', postingRule: 'per_night', chargeType: 'parking',
          lineItems: [{ date: '2026-10-02', amount: '15.00', taxAmount: '2.00' }],
        }],
      },
    };
    const candidate = {
      id: 'rs-1', serviceId: 'svc-1', status: 'confirmed', postingRule: 'per_night',
      chargeType: 'parking', unitPrice: '15.00', quantity: 1, currencyCode: 'EUR',
    };
    const cancelled = { ...candidate, status: 'cancelled' };
    const db = transactionalDb({
      select: stagedSelect([
        [{ rs: candidate, serviceName: 'Parking', reservation }],
        [{ rs: cancelled, serviceName: 'Parking', reservation }],
      ]),
    });
    const folio = {
      postCharge: vi.fn(), postChargeFromSnapshotWithOutcome: vi.fn(),
      emitSnapshotChargeWebhooks: vi.fn(),
    };
    const service = new AncillaryService(db as any, folio as any, { emit: vi.fn() } as any);

    const result = await service.postPerNightForProperty('prop-1', '2026-10-02');

    expect(result.count).toBe(0);
    expect(folio.postChargeFromSnapshotWithOutcome).not.toHaveBeenCalled();
  });

  it('re-reads the accepted service under the pricing lock before claiming a nightly group', async () => {
    const staleReservation = {
      id: 'res-1', propertyId: 'prop-1', guestId: 'guest-1', status: 'checked_in',
      acceptedPricingSnapshot: {
        currencyCode: 'EUR',
        services: [{
          serviceId: 'svc-1', postingRule: 'per_night', chargeType: 'parking',
          lineItems: [{ date: '2026-10-02', amount: '15.00', taxAmount: '2.00' }],
        }],
      },
    };
    const lockedReservation = {
      ...staleReservation,
      acceptedPricingSnapshot: { currencyCode: 'EUR', services: [] },
    };
    const rs = {
      id: 'rs-1', propertyId: 'prop-1', reservationId: 'res-1', serviceId: 'svc-1',
      status: 'confirmed', postingRule: 'per_night', chargeType: 'parking',
      unitPrice: '15.00', quantity: 1, currencyCode: 'EUR',
    };
    const db: any = {
      execute: vi.fn(async () => undefined),
      select: stagedSelect([
        [{ rs, serviceName: 'Parking', reservation: staleReservation }],
        [{ rs, serviceName: 'Parking', reservation: lockedReservation }],
      ]),
    };
    db.transaction = vi.fn(async (work: (tx: any) => Promise<unknown>) => work(db));
    const folio = {
      postCharge: vi.fn(),
      postChargeFromSnapshotWithOutcome: vi.fn(),
      emitSnapshotChargeWebhooks: vi.fn(),
    };
    const service = new AncillaryService(db, folio as any, { emit: vi.fn() } as any);

    const result = await service.postPerNightForProperty('prop-1', '2026-10-02');

    expect(result.count).toBe(0);
    expect(folio.postChargeFromSnapshotWithOutcome).not.toHaveBeenCalled();
    expect(db.select.reservationLockCount).toBe(1);
  });

  it('posts a once service from the amended snapshot when the live row is still per-night', async () => {
    const reservation = {
      id: 'res-1',
      propertyId: 'prop-1',
      guestId: 'guest-1',
      arrivalDate: '2026-10-01',
      acceptedPricingSnapshot: {
        currencyCode: 'EUR',
        services: [{
          serviceId: 'svc-1',
          postingRule: 'once',
          chargeType: 'fee',
          lineItems: [{ date: '2026-10-01', amount: '21.00', taxAmount: '3.00' }],
        }],
      },
    };
    const rs = {
      id: 'rs-1', serviceId: 'svc-1', unitPrice: '99.00', quantity: 1,
      chargeType: 'parking', currencyCode: 'EUR', postingRule: 'per_night', status: 'confirmed',
    };
    const db = transactionalDb({
      select: stagedSelect([[reservation], [{ id: 'folio-1' }], [{ rs, serviceName: 'Transfer' }]]),
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({ returning: vi.fn(async () => [{ ...rs, status: 'posted' }]) })),
        })),
      })),
    });
    const folio = {
      postCharge: vi.fn(),
      postChargeFromSnapshotWithOutcome: vi.fn().mockResolvedValue({
        charge: { id: 'charge-1' }, wasCreated: true,
      }),
      emitSnapshotChargeWebhooks: vi.fn(),
    };
    const service = new AncillaryService(db as any, folio as any, { emit: vi.fn() } as any);

    await service.postOnceForReservation('res-1', 'prop-1');

    expect(folio.postChargeFromSnapshotWithOutcome).toHaveBeenCalledWith(
      'folio-1',
      expect.objectContaining({ type: 'fee', amount: '21.00' }),
      '3.00',
      undefined,
      'accepted-pricing:reservation-service:rs-1:once:2026-10-01',
      expect.anything(),
    );
  });

  it('posts a re-dated once revision even when the operational row was already posted', async () => {
    const reservation = {
      id: 'res-1', propertyId: 'prop-1', guestId: 'guest-1', arrivalDate: '2026-10-02',
      acceptedPricingSnapshot: {
        currencyCode: 'EUR',
        services: [{
          serviceId: 'svc-1', postingRule: 'once', chargeType: 'parking',
          lineItems: [{ date: '2026-10-02', amount: '15.00', taxAmount: '2.00' }],
        }],
      },
    };
    const rs = {
      id: 'rs-1', serviceId: 'svc-1', status: 'posted', postingRule: 'once',
      chargeType: 'parking', unitPrice: '15.00', quantity: 1, currencyCode: 'EUR',
    };
    const db = transactionalDb({
      select: stagedSelect([[reservation], [{ id: 'folio-1' }], [{ rs, serviceName: 'Parking' }]]),
      update: vi.fn(),
    });
    const folio = {
      postCharge: vi.fn(),
      postChargeFromSnapshotWithOutcome: vi.fn().mockResolvedValue({
        charge: { id: 'charge-new-date' }, wasCreated: true,
      }),
      emitSnapshotChargeWebhooks: vi.fn(),
    };
    const webhook = { emit: vi.fn() };
    const service = new AncillaryService(db as any, folio as any, webhook as any);

    const result = await service.postOnceForReservation('res-1', 'prop-1');

    expect(result).toEqual({ posted: [rs], count: 1 });
    expect(db.update).not.toHaveBeenCalled();
    expect(folio.postChargeFromSnapshotWithOutcome).toHaveBeenCalledWith(
      'folio-1', expect.anything(), '2.00', undefined,
      'accepted-pricing:reservation-service:rs-1:once:2026-10-02', expect.anything(),
    );
    expect(webhook.emit).toHaveBeenCalledWith(
      'reservation.service_posted', 'reservation_service', 'rs-1',
      expect.objectContaining({ amount: '15.00', postingRule: 'once' }), 'prop-1',
    );
  });

  it('posts future per-night lines from the amended snapshot after a once service was marked posted', async () => {
    const reservation = {
      id: 'res-1', propertyId: 'prop-1', guestId: 'guest-1', status: 'checked_in',
      acceptedPricingSnapshot: {
        currencyCode: 'EUR',
        services: [{
          serviceId: 'svc-1',
          postingRule: 'per_night',
          chargeType: 'spa',
          lineItems: [{ date: '2026-10-03', amount: '30.00', taxAmount: '4.00' }],
        }],
      },
    };
    const rs = {
      id: 'rs-1', serviceId: 'svc-1', unitPrice: '15.00', quantity: 1,
      chargeType: 'parking', currencyCode: 'EUR', postingRule: 'once', status: 'posted',
    };
    const db = transactionalDb({
      select: stagedSelect([
        [{ rs, serviceName: 'Spa', reservation }],
        [{ rs, serviceName: 'Spa', reservation }],
        [{ id: 'folio-1' }],
      ]),
    });
    const folio = {
      postCharge: vi.fn(),
      postChargeFromSnapshotWithOutcome: vi.fn().mockResolvedValue({
        charge: { id: 'charge-1' }, wasCreated: true,
      }),
      emitSnapshotChargeWebhooks: vi.fn(),
    };
    const service = new AncillaryService(db as any, folio as any, { emit: vi.fn() } as any);

    const result = await service.postPerNightForProperty('prop-1', '2026-10-03');

    expect(folio.postChargeFromSnapshotWithOutcome).toHaveBeenCalledWith(
      'folio-1',
      expect.objectContaining({ type: 'spa', amount: '30.00' }),
      '4.00',
      undefined,
      'accepted-pricing:reservation-service:rs-1:night:2026-10-03',
      expect.anything(),
    );
    expect(result.count).toBe(1);
  });

  it('uses the amended snapshot dates instead of the stale live service range', async () => {
    const reservation = {
      id: 'res-1', propertyId: 'prop-1', guestId: 'guest-1', status: 'checked_in',
      acceptedPricingSnapshot: {
        currencyCode: 'EUR',
        services: [{
          serviceId: 'svc-1',
          postingRule: 'per_night',
          chargeType: 'spa',
          lineItems: [{ date: '2026-10-04', amount: '30.00', taxAmount: '4.00' }],
        }],
      },
    };
    const rs = {
      id: 'rs-1', serviceId: 'svc-1', unitPrice: '15.00', quantity: 1,
      chargeType: 'parking', currencyCode: 'EUR', postingRule: 'per_night',
      status: 'confirmed', startDate: '2026-10-01', endDate: '2026-10-02',
    };
    const db = transactionalDb({
      select: stagedSelect([
        [{ rs, serviceName: 'Spa', reservation }],
        [{ rs, serviceName: 'Spa', reservation }],
        [{ id: 'folio-1' }],
      ]),
    });
    const folio = {
      postCharge: vi.fn(),
      postChargeFromSnapshotWithOutcome: vi.fn().mockResolvedValue({
        charge: { id: 'charge-1' }, wasCreated: true,
      }),
      emitSnapshotChargeWebhooks: vi.fn(),
    };
    const service = new AncillaryService(db as any, folio as any, { emit: vi.fn() } as any);

    const result = await service.postPerNightForProperty('prop-1', '2026-10-04');

    expect(folio.postChargeFromSnapshotWithOutcome).toHaveBeenCalledWith(
      'folio-1',
      expect.objectContaining({ type: 'spa', amount: '30.00' }),
      '4.00',
      undefined,
      'accepted-pricing:reservation-service:rs-1:night:2026-10-04',
      expect.anything(),
    );
    expect(result.count).toBe(1);
  });

  it('does not post a live service row removed from the amended snapshot', async () => {
    const reservation = {
      id: 'res-1', propertyId: 'prop-1', guestId: 'guest-1', arrivalDate: '2026-10-01',
      acceptedPricingSnapshot: { currencyCode: 'EUR', services: [] },
    };
    const rs = {
      id: 'rs-1', serviceId: 'svc-1', unitPrice: '99.00', quantity: 1,
      chargeType: 'parking', currencyCode: 'EUR', postingRule: 'once', status: 'confirmed',
      sourceChannel: 'booking_engine',
    };
    const db = transactionalDb({
      select: stagedSelect([[reservation], [{ id: 'folio-1' }], [{ rs, serviceName: 'Parking' }]]),
      update: vi.fn(),
    });
    const folio = {
      postCharge: vi.fn(),
      postChargeFromSnapshotWithOutcome: vi.fn(),
      emitSnapshotChargeWebhooks: vi.fn(),
    };
    const service = new AncillaryService(db as any, folio as any, { emit: vi.fn() } as any);

    const result = await service.postOnceForReservation('res-1', 'prop-1');

    expect(result.count).toBe(0);
    expect(folio.postCharge).not.toHaveBeenCalled();
    expect(folio.postChargeFromSnapshotWithOutcome).not.toHaveBeenCalled();
  });

  it('recovers a confirmed once service when its accepted ledger group already exists', async () => {
    const { createDb, update } = acceptedOnceScenario();
    const { ledgerGroups, folio } = idempotentSnapshotPoster(true);
    const { webhook, eventEmitter, audits } = recordedWebhookService();
    const service = new AncillaryService(createDb() as any, folio as any, webhook);

    const result = await service.postOnceForReservation('res-1', 'prop-1');

    expect(ledgerGroups).toHaveLength(1);
    expect(update).toHaveBeenCalledOnce();
    expect(eventEmitter.emit).toHaveBeenCalledOnce();
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      'reservation.service_posted',
      expect.objectContaining({ entityId: 'rs-1', propertyId: 'prop-1' }),
    );
    expect(audits).toHaveLength(1);
    expect(result.count).toBe(1);
  });

  it('lets only one concurrent once-service replay win the state CAS and emit', async () => {
    const { createDb, update, casReturning } = acceptedOnceScenario();
    const { ledgerGroups, folio } = idempotentSnapshotPoster(true);
    const { webhook, eventEmitter, audits } = recordedWebhookService();
    const first = new AncillaryService(createDb() as any, folio as any, webhook);
    const second = new AncillaryService(createDb() as any, folio as any, webhook);

    const results = await Promise.all([
      first.postOnceForReservation('res-1', 'prop-1'),
      second.postOnceForReservation('res-1', 'prop-1'),
    ]);

    expect(ledgerGroups).toHaveLength(1);
    expect(update).toHaveBeenCalledOnce();
    expect(casReturning).toHaveBeenCalledOnce();
    expect(eventEmitter.emit).toHaveBeenCalledOnce();
    expect(audits).toHaveLength(1);
    expect(results.map((result) => result.count).sort()).toEqual([0, 1]);
  });

  it('lets only the concurrent per-night ledger winner emit', async () => {
    const reservation = {
      id: 'res-1',
      propertyId: 'prop-1',
      guestId: 'guest-1',
      status: 'checked_in',
      acceptedPricingSnapshot: {
        currencyCode: 'EUR',
        services: [{
          serviceId: 'svc-1',
          postingRule: 'per_night',
          chargeType: 'parking',
          lineItems: [{ date: '2026-10-02', amount: '15.00', taxAmount: '2.00' }],
        }],
      },
    };
    const rs = {
      id: 'rs-1',
      propertyId: 'prop-1',
      reservationId: 'res-1',
      serviceId: 'svc-1',
      unitPrice: '99.00',
      quantity: 1,
      chargeType: 'parking',
      currencyCode: 'EUR',
      postingRule: 'per_night',
      status: 'confirmed',
    };
    const createDb = () => transactionalDb({
      select: stagedSelect([
        [{ rs, serviceName: 'Parking', reservation }],
        [{ rs, serviceName: 'Parking', reservation }],
        [{ id: 'folio-1' }],
      ]),
    });
    const { ledgerGroups, folio } = idempotentSnapshotPoster();
    const { webhook, eventEmitter, audits } = recordedWebhookService();
    const first = new AncillaryService(createDb() as any, folio as any, webhook);
    const second = new AncillaryService(createDb() as any, folio as any, webhook);

    const results = await Promise.all([
      first.postPerNightForProperty('prop-1', '2026-10-02'),
      second.postPerNightForProperty('prop-1', '2026-10-02'),
    ]);

    expect(ledgerGroups).toHaveLength(1);
    expect(eventEmitter.emit).toHaveBeenCalledOnce();
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      'reservation.service_posted',
      expect.objectContaining({ entityId: 'rs-1', propertyId: 'prop-1' }),
    );
    expect(audits).toHaveLength(1);
    expect(results.flatMap((result) => result.posted)).toHaveLength(1);
    expect(results.flatMap((result) => result.skipped)).toEqual(['rs-1']);
    expect(results.flatMap((result) => result.errors)).toEqual([]);
  });

  it('uses a stable source key when concurrent check-in attempts post a once service', async () => {
    const reservation = {
      id: 'res-1',
      propertyId: 'prop-1',
      guestId: 'guest-1',
      arrivalDate: '2026-09-30',
      acceptedPricingSnapshot: {
        currencyCode: 'EUR',
        services: [{
          serviceId: 'svc-1',
          postingRule: 'once',
          chargeType: 'parking',
          lineItems: [{ date: '2026-10-01', amount: '15.00', taxAmount: '2.00' }],
        }],
      },
    };
    const rs = {
      id: 'rs-1',
      propertyId: 'prop-1',
      reservationId: 'res-1',
      serviceId: 'svc-1',
      unitPrice: '99.00',
      quantity: 1,
      chargeType: 'parking',
      currencyCode: 'EUR',
      postingRule: 'once',
      status: 'confirmed',
    };
    const db = transactionalDb({
      select: stagedSelect([
        [reservation],
        [{ id: 'folio-1' }],
        [{ rs, serviceName: 'Parking' }],
        [],
      ]),
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({
            returning: vi.fn(async () => [{ ...rs, status: 'posted' }]),
          })),
        })),
      })),
    });
    const folio = {
      postCharge: vi.fn(),
      postChargeFromSnapshotWithOutcome: vi.fn().mockResolvedValue({
        charge: { id: 'charge-1' },
        wasCreated: true,
      }),
      emitSnapshotChargeWebhooks: vi.fn(),
    };
    const service = new AncillaryService(
      db as any,
      folio as any,
      { emit: vi.fn() } as any,
    );

    await service.postOnceForReservation('res-1', 'prop-1');

    expect(folio.postChargeFromSnapshotWithOutcome).toHaveBeenCalledWith(
      'folio-1',
      expect.objectContaining({
        amount: '15.00',
        currencyCode: 'EUR',
        serviceDate: '2026-10-01T00:00:00.000Z',
      }),
      '2.00',
      undefined,
      'accepted-pricing:reservation-service:rs-1:once:2026-10-01',
      expect.anything(),
    );
  });

  it('posts the frozen per-night service and tax instead of live catalog pricing', async () => {
    const reservation = {
      id: 'res-1',
      propertyId: 'prop-1',
      guestId: 'guest-1',
      status: 'checked_in',
      acceptedPricingSnapshot: {
        currencyCode: 'EUR',
        services: [{
          serviceId: 'svc-1',
          postingRule: 'per_night',
          chargeType: 'parking',
          lineItems: [
            { date: '2026-10-01', amount: '15.00', taxAmount: '2.00' },
            { date: '2026-10-02', amount: '15.00', taxAmount: '2.00' },
          ],
        }],
      },
    };
    const current = {
      rs: {
        id: 'rs-1',
        serviceId: 'svc-1',
        unitPrice: '99.00',
        quantity: 1,
        chargeType: 'parking',
        currencyCode: 'EUR',
        postingRule: 'per_night',
        sourceChannel: 'booking_engine',
        status: 'confirmed',
      },
      serviceName: 'Parking',
      reservation,
    };
    const db = transactionalDb({
      select: stagedSelect([
        [current],
        [current],
        [{ id: 'folio-1' }],
      ]),
    });
    const folio = {
      postCharge: vi.fn(),
      postChargeFromSnapshotWithOutcome: vi.fn().mockResolvedValue({
        charge: { id: 'charge-1' },
        wasCreated: true,
      }),
      emitSnapshotChargeWebhooks: vi.fn(),
    };
    const webhook = { emit: vi.fn() };
    const service = new AncillaryService(db as any, folio as any, webhook as any);

    const result = await service.postPerNightForProperty('prop-1', '2026-10-02');

    expect(folio.postChargeFromSnapshotWithOutcome).toHaveBeenCalledWith(
      'folio-1',
      expect.objectContaining({ amount: '15.00', currencyCode: 'EUR' }),
      '2.00',
      undefined,
      'accepted-pricing:reservation-service:rs-1:night:2026-10-02',
      expect.anything(),
    );
    expect(folio.postCharge).not.toHaveBeenCalled();
    expect(result.posted).toEqual([
      { reservationServiceId: 'rs-1', chargeId: 'charge-1', amount: '15.00' },
    ]);
  });

  it('never attaches an unquoted package component at a live catalog price', async () => {
    const inserted: Record<string, unknown>[] = [];
    const db = {
      select: stagedSelect([
        [{ id: 'res-1', propertyId: 'prop-1', ratePlanId: 'rp-1' }],
        [{
          serviceId: 'svc-package',
          quantity: 1,
          amountOverride: null,
          includedInRate: false,
        }],
        [],
        [{
          id: 'svc-package',
          propertyId: 'prop-1',
          name: 'Package transfer',
          price: '125.00',
          currencyCode: 'EUR',
          postingRule: 'once',
          chargeType: 'fee',
        }],
      ]),
      insert: vi.fn(() => ({
        values: vi.fn((value: Record<string, unknown>) => {
          inserted.push(value);
          return {
            returning: vi.fn(async () => [{ id: 'rs-package', ...value }]),
          };
        }),
      })),
    };
    const service = new AncillaryService(
      db as any,
      {} as any,
      { emit: vi.fn() } as any,
    );

    await service.ensurePackageComponents(
      'res-1',
      'prop-1',
      db,
      { freezeUnquotedAtZero: true, currencyCode: 'EUR' },
    );

    expect(inserted[0]).toMatchObject({
      serviceId: 'svc-package',
      unitPrice: '0.00',
      currencyCode: 'EUR',
      sourceChannel: 'package',
    });
  });
});
