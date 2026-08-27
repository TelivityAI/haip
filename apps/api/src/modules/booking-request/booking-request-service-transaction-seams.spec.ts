import { describe, expect, it, vi } from 'vitest';
import {
  bookings,
  folios,
  guests,
  ratePlanComponents,
  reservationGuests,
  reservationServices,
  reservations,
  roomTypes,
  services,
} from '@telivityhaip/database';
import { GuestService } from '../guest/guest.service';
import { FolioService } from '../folio/folio.service';
import { ReservationService } from '../reservation/reservation.service';
import { AncillaryService } from '../ancillary/ancillary.service';

const PROPERTY_ID = 'aaaaaaaa-0000-4000-a000-000000000001';
const ROOM_TYPE_ID = 'cccccccc-0000-4000-a000-000000000001';
const RATE_PLAN_ID = 'dddddddd-0000-4000-a000-000000000001';
const RESERVATION_ID = 'eeeeeeee-0000-4000-a000-000000000001';
const FOLIO_ID = 'ffffffff-0000-4000-a000-000000000001';
const GUEST_ID = '11111111-0000-4000-a000-000000000001';

/**
 * `@telivityhaip/booking-requests`'s BookingRequestService relies on every
 * core creation-path service (Guest/Folio/Reservation/Ancillary) honoring an
 * explicit caller transaction instead of opening its own — this is the
 * contract the package's `ReservationServicePort` / `FolioServicePort` /
 * `GuestServicePort` / `AncillaryServicePort` `useExisting` bindings depend
 * on. These are core-service tests (not booking-request package tests) kept
 * in apps/api because they instantiate the real core classes directly.
 */
describe('canonical creation transaction seams', () => {
  it('GuestService.create uses the caller transaction', async () => {
    const mainDb = {
      insert: vi.fn(() => {
        throw new Error('main database used');
      }),
    };
    const tx = {
      insert: vi.fn((table: unknown) => {
        expect(table).toBe(guests);
        return {
          values: vi.fn(() => ({
            returning: vi.fn(async () => [{ id: GUEST_ID }]),
          })),
        };
      }),
    };
    const service = new GuestService(mainDb as any);

    const result = await (service.create as any)({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
    }, tx);

    expect(result).toEqual({ id: GUEST_ID });
    expect(mainDb.insert).not.toHaveBeenCalled();
  });

  it('FolioService.createAutoFolio uses the caller transaction and emits no pre-commit webhook', async () => {
    const mainDb = {
      select: vi.fn(() => {
        throw new Error('main database used');
      }),
      insert: vi.fn(() => {
        throw new Error('main database used');
      }),
    };
    const webhook = { emit: vi.fn() };
    const tx = {
      select: vi.fn(() => {
        let table: unknown;
        const chain: Record<string, unknown> & PromiseLike<unknown> = {
          from: vi.fn((value: unknown) => {
            table = value;
            return chain;
          }),
          where: vi.fn(() => chain),
          for: vi.fn(() => Promise.resolve(
            table === roomTypes ? [{ id: ROOM_TYPE_ID }] : [],
          )),
          then: (resolve, reject) => Promise.resolve(
            table === folios ? [{ maxNumber: null }] : [{ id: 'exists' }],
          ).then(resolve, reject),
        };
        return chain;
      }),
      insert: vi.fn((table: unknown) => {
        expect(table).toBe(folios);
        return {
          values: vi.fn((values: Record<string, unknown>) => ({
            returning: vi.fn(async () => [{ id: FOLIO_ID, ...values }]),
          })),
        };
      }),
    };
    const service = new FolioService(mainDb as any, webhook as any, {} as any);

    const result = await (service.createAutoFolio as any)({
      id: RESERVATION_ID,
      propertyId: PROPERTY_ID,
      bookingId: '33333333-0000-4000-a000-000000000001',
      guestId: GUEST_ID,
      currencyCode: 'EUR',
    }, tx);

    expect(result.id).toBe(FOLIO_ID);
    expect(mainDb.insert).not.toHaveBeenCalled();
    expect(webhook.emit).not.toHaveBeenCalled();
  });

  it('ReservationService.create performs every lookup and insert in the caller transaction', async () => {
    const mainDb = {
      select: vi.fn(() => {
        throw new Error('main database used');
      }),
      transaction: vi.fn(() => {
        throw new Error('nested transaction opened');
      }),
    };
    const tx = {
      select: vi.fn(() => {
        let table: unknown;
        const chain: Record<string, unknown> & PromiseLike<unknown> = {
          from: vi.fn((value: unknown) => {
            table = value;
            return chain;
          }),
          where: vi.fn(() => chain),
          for: vi.fn(() => Promise.resolve(
            table === roomTypes ? [{ id: ROOM_TYPE_ID }] : [],
          )),
          then: (resolve, reject) => Promise.resolve(
            table === guests
              ? [{ id: GUEST_ID, isDnr: false }]
              : [{ id: table === roomTypes ? ROOM_TYPE_ID : RATE_PLAN_ID }],
          ).then(resolve, reject),
        };
        return chain;
      }),
      insert: vi.fn((_table: unknown) => ({
        values: vi.fn((values: Record<string, unknown>) => {
          const row = _table === bookings
            ? { id: '33333333-0000-4000-a000-000000000001', ...values }
            : _table === reservations
              ? { id: RESERVATION_ID, ...values }
              : values;
          return {
            returning: vi.fn(async () => [row]),
            then: (resolve: (value: unknown) => unknown) => Promise.resolve(undefined).then(resolve),
          };
        }),
      })),
    };
    const availability = {
      searchAvailability: vi.fn(async () => [{
        roomTypeId: ROOM_TYPE_ID,
        date: '2026-10-01',
        available: 1,
      }, {
        roomTypeId: ROOM_TYPE_ID,
        date: '2026-10-02',
        available: 1,
      }]),
    };
    const webhook = { emit: vi.fn() };
    const ratePlan = { assertSellable: vi.fn(async () => undefined) };
    const service = new ReservationService(
      mainDb as any,
      availability as any,
      {} as any,
      {} as any,
      {} as any,
      webhook as any,
      {} as any,
      {} as any,
      {} as any,
      ratePlan as any,
    );

    const result = await (service.create as any)({
      propertyId: PROPERTY_ID,
      guestId: GUEST_ID,
      arrivalDate: '2026-10-01',
      departureDate: '2026-10-03',
      roomTypeId: ROOM_TYPE_ID,
      ratePlanId: RATE_PLAN_ID,
      totalAmount: '220.00',
      currencyCode: 'EUR',
      source: 'direct',
    }, {}, tx);

    expect(result.id).toBe(RESERVATION_ID);
    expect(mainDb.transaction).not.toHaveBeenCalled();
    expect(availability.searchAvailability).toHaveBeenCalledWith(
      PROPERTY_ID,
      '2026-10-01',
      '2026-10-03',
      ROOM_TYPE_ID,
      tx,
    );
    expect(ratePlan.assertSellable).toHaveBeenCalledWith(
      PROPERTY_ID,
      RATE_PLAN_ID,
      '2026-10-01',
      '2026-10-03',
      tx,
    );
    expect(tx.insert).toHaveBeenCalledWith(reservationGuests);
    expect(webhook.emit).not.toHaveBeenCalled();
  });

  it('AncillaryService attach and package ensure use the caller transaction without emitting', async () => {
    const mainDb = {
      select: vi.fn(() => {
        throw new Error('main database used');
      }),
      insert: vi.fn(() => {
        throw new Error('main database used');
      }),
    };
    const inserted: Array<Record<string, unknown>> = [];
    const tx = {
      select: vi.fn((selection?: Record<string, unknown>) => {
        let table: unknown;
        const chain: Record<string, unknown> & PromiseLike<unknown> = {
          from: vi.fn((value: unknown) => {
            table = value;
            return chain;
          }),
          where: vi.fn(() => chain),
          then: (resolve, reject) => Promise.resolve(
            table === reservations
              ? [{ id: RESERVATION_ID, propertyId: PROPERTY_ID, ratePlanId: RATE_PLAN_ID }]
              : table === services
                ? [{
                    id: '77777777-0000-4000-a000-000000000001',
                    propertyId: PROPERTY_ID,
                    isActive: true,
                    price: '25.00',
                    currencyCode: 'EUR',
                    postingRule: 'once',
                    chargeType: 'fee',
                    name: 'Breakfast',
                  }]
                : table === ratePlanComponents
                  ? [{
                      serviceId: '77777777-0000-4000-a000-000000000001',
                      quantity: 1,
                      includedInRate: true,
                      amountOverride: null,
                    }]
                  : table === reservationServices && selection
                    ? []
                    : [],
          ).then(resolve, reject),
        };
        return chain;
      }),
      insert: vi.fn((_table: unknown) => ({
        values: vi.fn((values: Record<string, unknown>) => ({
          returning: vi.fn(async () => {
            const row = {
              id: `88888888-0000-4000-a000-${String(inserted.length + 1).padStart(12, '0')}`,
              ...values,
            };
            inserted.push(row);
            return [row];
          }),
        })),
      })),
    };
    const webhook = { emit: vi.fn() };
    const service = new AncillaryService(mainDb as any, {} as any, webhook as any);

    const selected = await (service.attachToReservation as any)(RESERVATION_ID, {
      propertyId: PROPERTY_ID,
      serviceId: '77777777-0000-4000-a000-000000000001',
      sourceChannel: 'booking_engine',
    }, tx);
    const packaged = await (service.ensurePackageComponents as any)(
      RESERVATION_ID,
      PROPERTY_ID,
      tx,
    );

    expect(selected.reservationId).toBe(RESERVATION_ID);
    expect(packaged).toHaveLength(1);
    expect(mainDb.select).not.toHaveBeenCalled();
    expect(mainDb.insert).not.toHaveBeenCalled();
    expect(webhook.emit).not.toHaveBeenCalled();
  });
});
