import { describe, expect, it, vi } from 'vitest';
import { AncillaryService } from './ancillary.service';

function stagedSelect(stages: any[][]) {
  let index = 0;
  return vi.fn(() => {
    const rows = stages[index++] ?? [];
    const promise = Promise.resolve(rows);
    const chain: any = {
      from: vi.fn(() => chain),
      innerJoin: vi.fn(() => chain),
      where: vi.fn(() => chain),
      limit: vi.fn(() => promise),
      then: promise.then.bind(promise),
    };
    return chain;
  });
}

describe('AncillaryService accepted operational pricing', () => {
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
          lineItems: [
            { date: '2026-10-01', amount: '15.00', taxAmount: '2.00' },
            { date: '2026-10-02', amount: '15.00', taxAmount: '2.00' },
          ],
        }],
      },
    };
    const db = {
      select: stagedSelect([
        [{
          rs: {
            id: 'rs-1',
            serviceId: 'svc-1',
            unitPrice: '99.00',
            quantity: 1,
            chargeType: 'parking',
            currencyCode: 'EUR',
            postingRule: 'per_night',
            sourceChannel: 'booking_engine',
          },
          serviceName: 'Parking',
          reservation,
        }],
        [{ id: 'folio-1' }],
        [],
      ]),
    };
    const folio = {
      postCharge: vi.fn(),
      postChargeFromSnapshot: vi.fn().mockResolvedValue({ id: 'charge-1' }),
    };
    const webhook = { emit: vi.fn() };
    const service = new AncillaryService(db as any, folio as any, webhook as any);

    const result = await service.postPerNightForProperty('prop-1', '2026-10-02');

    expect(folio.postChargeFromSnapshot).toHaveBeenCalledWith(
      'folio-1',
      expect.objectContaining({ amount: '15.00', currencyCode: 'EUR' }),
      '2.00',
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
