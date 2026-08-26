import { describe, it, expect, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ReservationService } from './reservation.service';
import { DRIZZLE } from '../../database/database.module';
import { AvailabilityService } from './availability.service';
import { FolioService } from '../folio/folio.service';
import { RoomStatusService } from '../room/room-status.service';
import { PaymentService } from '../payment/payment.service';
import { WebhookService } from '../webhook/webhook.service';
import { AncillaryService } from '../ancillary/ancillary.service';
import { PolicyService } from '../policy/policy.service';
import { DepositSettlementService } from '../accounting/deposit-settlement.service';
import { RatePlanService } from '../rate-plan/rate-plan.service';
import {
  bookings,
  reservationGuests,
  reservations,
} from '@telivityhaip/database';
import { validate } from 'class-validator';
import { ModifyReservationDto } from './dto/modify-reservation.dto';

const PROPERTY = 'aaaaaaaa-0000-4000-a000-000000000001';
const RATE_PLAN = 'rp-001';
const ROOM_TYPE = 'rt-001';

function mkDb() {
  const inventoryLock = vi.fn().mockResolvedValue([{ id: ROOM_TYPE }]);
  return {
    select: vi.fn().mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn()
          // guest → roomType FK → ratePlan FK
          .mockResolvedValueOnce([{ id: 'g', isDnr: false }])
          .mockResolvedValueOnce([{ id: ROOM_TYPE }])
          .mockResolvedValueOnce([{ id: RATE_PLAN }]),
      }),
    })),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{}]) }),
    }),
    update: vi.fn(),
    transaction: vi.fn().mockImplementation(async (cb: any) =>
      cb({
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({ for: inventoryLock }),
          }),
        }),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: 'res-1', arrivalDate: '2026-07-01' }]),
          }),
        }),
      }),
    ),
  };
}

async function mkService(assertSellable: ReturnType<typeof vi.fn>, db = mkDb()) {
  const availability = {
    searchAvailability: vi.fn().mockResolvedValue([
      { roomTypeId: ROOM_TYPE, date: '2026-07-01', available: 2 },
      { roomTypeId: ROOM_TYPE, date: '2026-07-02', available: 2 },
    ]),
  };
  const mod = await Test.createTestingModule({
    providers: [
      ReservationService,
      { provide: DRIZZLE, useValue: db },
      { provide: AvailabilityService, useValue: availability },
      { provide: FolioService, useValue: {} },
      { provide: RoomStatusService, useValue: {} },
      { provide: PaymentService, useValue: {} },
      { provide: WebhookService, useValue: { emit: vi.fn() } },
      {
        provide: AncillaryService,
        useValue: {
          ensurePackageComponents: async () => [],
          postOnceForReservation: async () => ({ posted: [] }),
        },
      },
      {
        provide: PolicyService,
        useValue: {
          evaluateCancellation: async () => ({
            withinFreeWindow: true,
            penaltyAmount: '0.00',
            depositAction: 'refund',
            policyDescription: 'test',
            policyId: null,
            policyCode: null,
            penaltyType: 'none',
          }),
        },
      },
      {
        provide: DepositSettlementService,
        useValue: { settleFromEvaluation: async () => null, applyHeldDeposits: async () => [] },
      },
      { provide: RatePlanService, useValue: { assertSellable } },
    ],
  }).compile();
  return { svc: mod.get(ReservationService), db, availability };
}

describe('ReservationService.create — assertSellable (BOOK path)', () => {
  it('calls RatePlanService.assertSellable with propertyId + stay dates before insert', async () => {
    const assertSellable = vi.fn().mockResolvedValue(undefined);
    const { svc, db } = await mkService(assertSellable);

    await svc.create({
      propertyId: PROPERTY,
      roomTypeId: ROOM_TYPE,
      ratePlanId: RATE_PLAN,
      arrivalDate: '2026-07-01',
      departureDate: '2026-07-03',
      totalAmount: '300.00',
      currencyCode: 'USD',
      guestId: 'g',
    } as any);

    expect(assertSellable).toHaveBeenCalledWith(PROPERTY, RATE_PLAN, '2026-07-01', '2026-07-03');
    expect(db.transaction).toHaveBeenCalled();
  });

  it('propagates assertSellable failure and does not insert', async () => {
    const assertSellable = vi
      .fn()
      .mockRejectedValue(new BadRequestException('Rate plan is closed (stop-sell) for the selected dates'));
    const { svc, db } = await mkService(assertSellable);

    await expect(
      svc.create({
        propertyId: PROPERTY,
        roomTypeId: ROOM_TYPE,
        ratePlanId: RATE_PLAN,
        arrivalDate: '2026-07-01',
        departureDate: '2026-07-03',
        totalAmount: '300.00',
        currencyCode: 'USD',
        guestId: 'g',
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('rejects creation when any night in the complete stay is unavailable', async () => {
    const assertSellable = vi.fn().mockResolvedValue(undefined);
    const { svc, availability } = await mkService(assertSellable);
    availability.searchAvailability.mockResolvedValue([
      { roomTypeId: ROOM_TYPE, date: '2026-07-01', available: 1 },
    ]);

    await expect(svc.create({
      propertyId: PROPERTY,
      roomTypeId: ROOM_TYPE,
      ratePlanId: RATE_PLAN,
      arrivalDate: '2026-07-01',
      departureDate: '2026-07-03',
      totalAmount: '300.00',
      currencyCode: 'USD',
      guestId: 'g',
    } as any)).rejects.toThrow(/2026-07-02/);
  });

  it('rejects a modified stay when the availability result omits a new night', async () => {
    const { svc, availability } = await mkService(
      vi.fn().mockResolvedValue(undefined),
    );
    vi.spyOn(svc as any, 'findByIdRaw').mockResolvedValue({
      id: 'res-1',
      propertyId: PROPERTY,
      status: 'confirmed',
      arrivalDate: '2026-07-01',
      departureDate: '2026-07-03',
      roomTypeId: ROOM_TYPE,
      ratePlanId: RATE_PLAN,
    });
    availability.searchAvailability.mockResolvedValue([
      { roomTypeId: ROOM_TYPE, date: '2026-07-01', available: 0 },
      { roomTypeId: ROOM_TYPE, date: '2026-07-02', available: 0 },
    ]);

    await expect(svc.modify('res-1', PROPERTY, {
      departureDate: '2026-07-04',
    } as any)).rejects.toThrow(/2026-07-03/);
  });

  it.each([
    [{ departureDate: '2026-07-04' }, 'stay dates'],
    [{ totalAmount: '325.00' }, 'accepted total'],
    [{ ratePlanId: 'rp-002' }, 'rate plan'],
    [{ roomTypeId: 'rt-002' }, 'room type'],
    [{ adults: 3 }, 'occupancy'],
  ] as const)(
    'requires a Stay Amendment before changing accepted pricing via %s',
    async (change, _label) => {
      const { svc, db } = await mkService(vi.fn().mockResolvedValue(undefined));
      vi.spyOn(svc as any, 'findByIdRaw').mockResolvedValue({
        id: 'res-1',
        propertyId: PROPERTY,
        status: 'confirmed',
        arrivalDate: '2026-07-01',
        departureDate: '2026-07-03',
        roomTypeId: ROOM_TYPE,
        ratePlanId: RATE_PLAN,
        totalAmount: '300.00',
        adults: 2,
        children: 0,
        acceptedPricingSnapshot: { version: 1, source: 'submitted' },
      });

      await expect(svc.modify('res-1', PROPERTY, change as any)).rejects.toThrow(
        /Stay Amendment.*accepted pricing/i,
      );
      expect(db.transaction).not.toHaveBeenCalled();
    },
  );

  it('retains safe metadata edits on an accepted-pricing reservation', async () => {
    const updated = {
      id: 'res-1',
      propertyId: PROPERTY,
      status: 'confirmed',
      arrivalDate: '2026-07-01',
      departureDate: '2026-07-03',
      roomTypeId: ROOM_TYPE,
      ratePlanId: RATE_PLAN,
      totalAmount: '300.00',
      adults: 2,
      children: 0,
      specialRequests: 'Late arrival',
      doNotMove: true,
      acceptedPricingSnapshot: { version: 1, source: 'submitted' },
    };
    const returning = vi.fn().mockResolvedValue([updated]);
    const where = vi.fn().mockReturnValue({ returning });
    const set = vi.fn().mockReturnValue({ where });
    const update = vi.fn().mockReturnValue({ set });
    const db = mkDb();
    db.transaction.mockImplementation(async (callback: (tx: any) => Promise<unknown>) =>
      callback({ update }));
    const { svc } = await mkService(vi.fn().mockResolvedValue(undefined), db);
    vi.spyOn(svc as any, 'findByIdRaw').mockResolvedValue({
      ...updated,
      specialRequests: null,
      doNotMove: false,
    });

    const result = await svc.modify('res-1', PROPERTY, {
      specialRequests: 'Late arrival',
      doNotMove: true,
    });

    expect(result).toMatchObject({
      reservation: {
        specialRequests: 'Late arrival',
        doNotMove: true,
        acceptedPricingSnapshot: expect.any(Object),
      },
      previousArrivalDate: '2026-07-01',
      previousDepartureDate: '2026-07-03',
      previousTotalAmount: '300.00',
      newTotalAmount: '300.00',
    });
    expect(set).toHaveBeenCalledWith(expect.objectContaining({
      specialRequests: 'Late arrival',
      doNotMove: true,
    }));
  });

  it('updates accepted dates, total, and pricing only through the locked amendment seam', async () => {
    const previousSnapshot = {
      version: 1 as const,
      source: 'current' as const,
      currencyCode: 'USD',
      grandTotal: '300.00',
      roomTotal: '270.00',
      taxTotal: '30.00',
      nights: [
        { date: '2026-07-01', roomAmount: '135.00', taxAmount: '15.00' },
        { date: '2026-07-02', roomAmount: '135.00', taxAmount: '15.00' },
      ],
      services: [],
      servicesTotal: '0.00',
      servicesTaxTotal: '0.00',
      customReason: null,
      adjustment: null,
    };
    const nextSnapshot = {
      ...structuredClone(previousSnapshot),
      source: 'prior' as const,
      grandTotal: '450.00',
      roomTotal: '405.00',
      taxTotal: '45.00',
      nights: [
        ...previousSnapshot.nights,
        { date: '2026-07-03', roomAmount: '135.00', taxAmount: '15.00' },
      ],
    };
    const locked = {
      id: 'res-1',
      propertyId: PROPERTY,
      status: 'confirmed',
      arrivalDate: '2026-07-01',
      departureDate: '2026-07-03',
      nights: 2,
      roomTypeId: ROOM_TYPE,
      ratePlanId: RATE_PLAN,
      totalAmount: '300.00',
      currencyCode: 'USD',
      acceptedPricingSnapshot: previousSnapshot,
    };
    const updated = {
      ...locked,
      departureDate: '2026-07-04',
      nights: 3,
      totalAmount: '450.00',
      acceptedPricingSnapshot: nextSnapshot,
    };
    const returning = vi.fn().mockResolvedValue([updated]);
    const where = vi.fn().mockReturnValue({ returning });
    const set = vi.fn().mockReturnValue({ where });
    const tx = { update: vi.fn().mockReturnValue({ set }) };
    const { svc, availability } = await mkService(vi.fn().mockResolvedValue(undefined));

    const result = await svc.modifyAcceptedStay(
      locked as any,
      PROPERTY,
      {
        arrivalDate: '2026-07-01',
        departureDate: '2026-07-04',
        totalAmount: '450.00',
      },
      nextSnapshot,
      tx,
    );

    expect(result).toEqual({
      reservation: updated,
      previousArrivalDate: '2026-07-01',
      previousDepartureDate: '2026-07-03',
      previousTotalAmount: '300.00',
      newTotalAmount: '450.00',
    });
    expect(set).toHaveBeenCalledWith(expect.objectContaining({
      departureDate: '2026-07-04',
      nights: 3,
      totalAmount: '450.00',
      acceptedPricingSnapshot: nextSnapshot,
    }));
    expect(availability.searchAvailability).not.toHaveBeenCalled();
  });

  it('requires canonical date-only values in the generic modification DTO', async () => {
    const dto = Object.assign(new ModifyReservationDto(), {
      arrivalDate: '2026-07-01T10:00:00.000Z',
      departureDate: '2026-07-03',
    });
    const errors = await validate(dto);
    expect(errors.some((error) => error.property === 'arrivalDate')).toBe(true);
  });

  it('serializes two canonical creates competing for the final room', async () => {
    let reservationCount = 0;
    let bookingCount = 0;
    let lockQueue = Promise.resolve();
    const db: any = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(async () => [{ id: 'owned', isDnr: false }]),
        })),
      })),
      transaction: vi.fn(async (callback: (tx: any) => Promise<unknown>) => {
        let release = () => undefined;
        const previous = lockQueue;
        lockQueue = new Promise<void>((resolve) => {
          release = resolve;
        });
        const tx = {
          select: vi.fn(() => ({
            from: vi.fn(() => ({
              where: vi.fn(() => ({
                for: vi.fn(async () => {
                  await previous;
                  return [{ id: ROOM_TYPE }];
                }),
              })),
            })),
          })),
          insert: vi.fn((table: unknown) => ({
            values: vi.fn((values: Record<string, unknown>) => {
              if (table === reservationGuests) return Promise.resolve();
              return {
                returning: vi.fn(async () => {
                  if (table === bookings) {
                    bookingCount += 1;
                    return [{ id: `booking-${bookingCount}`, ...values }];
                  }
                  if (table === reservations) {
                    reservationCount += 1;
                    return [{ id: `reservation-${reservationCount}`, ...values }];
                  }
                  return [];
                }),
              };
            }),
          })),
        };
        try {
          return await callback(tx);
        } finally {
          release();
        }
      }),
    };
    const { svc, availability } = await mkService(
      vi.fn().mockResolvedValue(undefined),
      db,
    );
    availability.searchAvailability.mockImplementation(async () => [
      { roomTypeId: ROOM_TYPE, date: '2026-07-01', available: reservationCount === 0 ? 1 : 0 },
      { roomTypeId: ROOM_TYPE, date: '2026-07-02', available: reservationCount === 0 ? 1 : 0 },
    ]);
    const dto = {
      propertyId: PROPERTY,
      roomTypeId: ROOM_TYPE,
      ratePlanId: RATE_PLAN,
      arrivalDate: '2026-07-01',
      departureDate: '2026-07-03',
      totalAmount: '300.00',
      currencyCode: 'USD',
      guestId: 'g',
      source: 'direct',
    } as any;

    const results = await Promise.allSettled([
      svc.create(dto),
      svc.create(dto),
    ]);

    expect(results.map((result) => result.status).sort()).toEqual([
      'fulfilled',
      'rejected',
    ]);
    expect(reservationCount).toBe(1);
  });
});
