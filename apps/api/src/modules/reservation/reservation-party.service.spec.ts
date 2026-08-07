import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ReservationPartyService } from './reservation-party.service';
import { DRIZZLE } from '../../database/database.module';
import { WebhookService } from '../webhook/webhook.service';
import { RoomStatusService } from '../room/room-status.service';
import { RatePlanService } from '../rate-plan/rate-plan.service';

const PROPERTY = 'prop-001';
const RES_A = 'res-a';
const RES_B = 'res-b';
const BOOKING = 'book-001';
const GUEST_PRIMARY = 'guest-p';
const GUEST_ACC = 'guest-a';
const GUEST_NEW = 'guest-n';

describe('ReservationPartyService', () => {
  let svc: ReservationPartyService;
  let db: any;
  let webhook: { emit: ReturnType<typeof vi.fn> };
  let roomStatus: { markOccupied: ReturnType<typeof vi.fn> };

  const sourceReservation = {
    id: RES_A,
    propertyId: PROPERTY,
    bookingId: BOOKING,
    guestId: GUEST_PRIMARY,
    roomTypeId: 'rt-001',
    ratePlanId: 'rp-001',
    arrivalDate: '2026-08-01',
    departureDate: '2026-08-03',
    nights: 2,
    status: 'confirmed',
    adults: 2,
    children: 0,
    currencyCode: 'USD',
    totalAmount: '400.00',
    groupProfileId: null,
    specialRequests: null,
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    webhook = { emit: vi.fn().mockResolvedValue(undefined) };
    roomStatus = { markOccupied: vi.fn().mockResolvedValue({}) };

    db = {
      select: vi.fn(),
      insert: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      transaction: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReservationPartyService,
        { provide: DRIZZLE, useValue: db },
        { provide: WebhookService, useValue: webhook },
        { provide: RoomStatusService, useValue: roomStatus },
        {
          provide: RatePlanService,
          useValue: { assertSellable: vi.fn().mockResolvedValue(undefined) },
        },
      ],
    }).compile();

    svc = module.get(ReservationPartyService);
  });

  function mockSelectSequence(resolutions: any[]) {
    let i = 0;
    db.select.mockImplementation(() => {
      const value = resolutions[i++] ?? [];
      const terminal = {
        limit: vi.fn().mockResolvedValue(Array.isArray(value) ? value : [value]),
        orderBy: vi.fn().mockResolvedValue(Array.isArray(value) ? value : [value]),
        then: (resolve: any) => resolve(Array.isArray(value) ? value : [value]),
      };
      const where = vi.fn().mockReturnValue(terminal);
      const from = vi.fn().mockReturnValue({
        where,
        leftJoin: vi.fn().mockReturnThis(),
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue(terminal),
        }),
      });
      // Support chained leftJoins used by listBookingSiblings
      const chain: any = {
        where,
        leftJoin: vi.fn().mockImplementation(() => chain),
        innerJoin: vi.fn().mockImplementation(() => ({
          where: vi.fn().mockReturnValue(terminal),
        })),
        orderBy: terminal.orderBy,
      };
      from.mockReturnValue(chain);
      return { from };
    });
  }

  describe('addGuest', () => {
    it('adds an accompanying guest and bumps adults', async () => {
      mockSelectSequence([
        [sourceReservation], // requireReservation
        [{ id: GUEST_NEW, isDnr: false, isDeleted: false }], // guest profile
        [], // existing on this res
        [], // not on sibling
        [
          {
            id: 'rg-1',
            propertyId: PROPERTY,
            reservationId: RES_A,
            guestId: GUEST_PRIMARY,
            role: 'primary',
            firstName: 'Pat',
            lastName: 'Primary',
            email: null,
          },
        ], // loadOccupants
        [{ maxOccupancy: 4 }], // room type cap
      ]);

      const inserted = {
        id: 'rg-new',
        propertyId: PROPERTY,
        reservationId: RES_A,
        guestId: GUEST_NEW,
        role: 'accompanying',
      };
      db.insert.mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([inserted]),
        }),
      });
      db.update.mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      });

      const result = await svc.addGuest(RES_A, PROPERTY, { guestId: GUEST_NEW });
      expect(result.guestId).toBe(GUEST_NEW);
      expect(webhook.emit).toHaveBeenCalledWith(
        'reservation.guest_added',
        'reservation',
        RES_A,
        expect.objectContaining({ guestId: GUEST_NEW }),
        PROPERTY,
      );
    });

    it('rejects DNR guests', async () => {
      mockSelectSequence([
        [sourceReservation],
        [{ id: GUEST_NEW, isDnr: true, dnrReason: 'fraud', isDeleted: false }],
      ]);
      await expect(svc.addGuest(RES_A, PROPERTY, { guestId: GUEST_NEW })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('rejects when adding would exceed max occupancy and no override is given', async () => {
      mockSelectSequence([
        [sourceReservation], // requireReservation
        [{ id: GUEST_NEW, isDnr: false, isDeleted: false }], // guest profile
        [], // existing on this res
        [], // not on sibling
        [
          {
            id: 'rg-1',
            propertyId: PROPERTY,
            reservationId: RES_A,
            guestId: GUEST_PRIMARY,
            role: 'primary',
            firstName: 'Pat',
            lastName: 'Primary',
            email: null,
          },
        ], // loadOccupants (1 occupant already)
        [{ maxOccupancy: 1 }], // room type cap — adding a 2nd named guest exceeds it
      ]);

      await expect(svc.addGuest(RES_A, PROPERTY, { guestId: GUEST_NEW })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('skips the max occupancy check when overrideMaxOccupancy is true', async () => {
      mockSelectSequence([
        [sourceReservation], // requireReservation
        [{ id: GUEST_NEW, isDnr: false, isDeleted: false }], // guest profile
        [], // existing on this res
        [], // not on sibling
        [
          {
            id: 'rg-1',
            propertyId: PROPERTY,
            reservationId: RES_A,
            guestId: GUEST_PRIMARY,
            role: 'primary',
            firstName: 'Pat',
            lastName: 'Primary',
            email: null,
          },
        ], // loadOccupants (1 occupant already)
        // No room type cap lookup should occur — assertWithinMaxOccupancy is skipped entirely.
      ]);

      const inserted = {
        id: 'rg-new',
        propertyId: PROPERTY,
        reservationId: RES_A,
        guestId: GUEST_NEW,
        role: 'accompanying',
      };
      db.insert.mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([inserted]),
        }),
      });
      db.update.mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      });

      const result = await svc.addGuest(RES_A, PROPERTY, {
        guestId: GUEST_NEW,
        overrideMaxOccupancy: true,
      });
      expect(result.guestId).toBe(GUEST_NEW);
    });
  });

  describe('removeGuest', () => {
    it('blocks removing the primary guest', async () => {
      mockSelectSequence([
        [sourceReservation],
        [
          {
            id: 'rg-1',
            propertyId: PROPERTY,
            reservationId: RES_A,
            guestId: GUEST_PRIMARY,
            role: 'primary',
            firstName: 'Pat',
            lastName: 'Primary',
            email: null,
          },
          {
            id: 'rg-2',
            propertyId: PROPERTY,
            reservationId: RES_A,
            guestId: GUEST_ACC,
            role: 'accompanying',
            firstName: 'Ann',
            lastName: 'Acc',
            email: null,
          },
        ],
      ]);
      await expect(svc.removeGuest(RES_A, PROPERTY, GUEST_PRIMARY)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('split', () => {
    it('creates a sibling reservation and moves selected guests', async () => {
      mockSelectSequence([
        [sourceReservation], // requireReservation
        [
          {
            id: 'rg-1',
            propertyId: PROPERTY,
            reservationId: RES_A,
            guestId: GUEST_PRIMARY,
            role: 'primary',
            firstName: 'Pat',
            lastName: 'Primary',
            email: null,
          },
          {
            id: 'rg-2',
            propertyId: PROPERTY,
            reservationId: RES_A,
            guestId: GUEST_ACC,
            role: 'accompanying',
            firstName: 'Ann',
            lastName: 'Acc',
            email: null,
          },
        ], // occupants
        [{ id: 'rt-002' }], // room type fk
        [{ id: 'rp-002' }], // rate plan fk
      ]);

      const created = {
        id: 'res-new',
        propertyId: PROPERTY,
        bookingId: BOOKING,
        guestId: GUEST_ACC,
        roomTypeId: 'rt-002',
        arrivalDate: '2026-08-01',
        departureDate: '2026-08-03',
        status: 'confirmed',
      };

      db.transaction.mockImplementation(async (cb: any) => {
        const tx = {
          insert: vi.fn().mockReturnValue({
            values: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([created]),
            }),
          }),
          update: vi.fn().mockReturnValue({
            set: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([]),
            }),
          }),
        };
        return cb(tx);
      });

      const result = await svc.split(RES_A, PROPERTY, {
        guestIds: [GUEST_ACC],
        roomTypeId: 'rt-002',
        ratePlanId: 'rp-002',
        totalAmount: '200.00',
      });

      expect(result.reservation.id).toBe('res-new');
      expect(result.movedGuestIds).toEqual([GUEST_ACC]);
      expect(webhook.emit).toHaveBeenCalledWith(
        'reservation.split',
        'reservation',
        RES_A,
        expect.objectContaining({ newReservationId: 'res-new' }),
        PROPERTY,
      );
    });

    it('rejects splitting every guest off the source', async () => {
      mockSelectSequence([
        [sourceReservation],
        [
          {
            id: 'rg-1',
            propertyId: PROPERTY,
            reservationId: RES_A,
            guestId: GUEST_PRIMARY,
            role: 'primary',
            firstName: 'Pat',
            lastName: 'Primary',
            email: null,
          },
        ],
      ]);
      await expect(
        svc.split(RES_A, PROPERTY, {
          guestIds: [GUEST_PRIMARY],
          roomTypeId: 'rt-002',
          ratePlanId: 'rp-002',
          totalAmount: '200.00',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects when the destination room type max occupancy is exceeded and no override is given', async () => {
      const guestAcc2 = 'guest-a2';
      mockSelectSequence([
        [sourceReservation], // requireReservation
        [
          {
            id: 'rg-1',
            propertyId: PROPERTY,
            reservationId: RES_A,
            guestId: GUEST_PRIMARY,
            role: 'primary',
            firstName: 'Pat',
            lastName: 'Primary',
            email: null,
          },
          {
            id: 'rg-2',
            propertyId: PROPERTY,
            reservationId: RES_A,
            guestId: GUEST_ACC,
            role: 'accompanying',
            firstName: 'Ann',
            lastName: 'Acc',
            email: null,
          },
          {
            id: 'rg-3',
            propertyId: PROPERTY,
            reservationId: RES_A,
            guestId: guestAcc2,
            role: 'accompanying',
            firstName: 'Ann2',
            lastName: 'Acc2',
            email: null,
          },
        ], // occupants
        [{ id: 'rt-002' }], // room type fk
        [{ id: 'rp-002' }], // rate plan fk
        [{ maxOccupancy: 1 }], // destination room type cap — moving 2 guests exceeds it
      ]);

      await expect(
        svc.split(RES_A, PROPERTY, {
          guestIds: [GUEST_ACC, guestAcc2],
          roomTypeId: 'rt-002',
          ratePlanId: 'rp-002',
          totalAmount: '200.00',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('allows exceeding the destination max occupancy when overrideMaxOccupancy is true', async () => {
      const guestAcc2 = 'guest-a2';
      mockSelectSequence([
        [sourceReservation], // requireReservation
        [
          {
            id: 'rg-1',
            propertyId: PROPERTY,
            reservationId: RES_A,
            guestId: GUEST_PRIMARY,
            role: 'primary',
            firstName: 'Pat',
            lastName: 'Primary',
            email: null,
          },
          {
            id: 'rg-2',
            propertyId: PROPERTY,
            reservationId: RES_A,
            guestId: GUEST_ACC,
            role: 'accompanying',
            firstName: 'Ann',
            lastName: 'Acc',
            email: null,
          },
          {
            id: 'rg-3',
            propertyId: PROPERTY,
            reservationId: RES_A,
            guestId: guestAcc2,
            role: 'accompanying',
            firstName: 'Ann2',
            lastName: 'Acc2',
            email: null,
          },
        ], // occupants
        [{ id: 'rt-002' }], // room type fk
        [{ id: 'rp-002' }], // rate plan fk
        // No room type cap lookup should occur — assertWithinMaxOccupancy is skipped entirely.
      ]);

      const created = {
        id: 'res-new',
        propertyId: PROPERTY,
        bookingId: BOOKING,
        guestId: GUEST_ACC,
        roomTypeId: 'rt-002',
        arrivalDate: '2026-08-01',
        departureDate: '2026-08-03',
        status: 'confirmed',
      };

      db.transaction.mockImplementation(async (cb: any) => {
        const tx = {
          insert: vi.fn().mockReturnValue({
            values: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([created]),
            }),
          }),
          update: vi.fn().mockReturnValue({
            set: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([]),
            }),
          }),
        };
        return cb(tx);
      });

      const result = await svc.split(RES_A, PROPERTY, {
        guestIds: [GUEST_ACC, guestAcc2],
        roomTypeId: 'rt-002',
        ratePlanId: 'rp-002',
        totalAmount: '200.00',
        overrideMaxOccupancy: true,
      });

      expect(result.reservation.id).toBe('res-new');
    });
  });

  describe('moveGuest', () => {
    it('moves a guest between sibling reservations on the same booking', async () => {
      const target = {
        ...sourceReservation,
        id: RES_B,
        guestId: 'guest-other',
        adults: 1,
      };
      mockSelectSequence([
        [sourceReservation], // source
        [target], // target
        [
          {
            id: 'rg-1',
            propertyId: PROPERTY,
            reservationId: RES_A,
            guestId: GUEST_PRIMARY,
            role: 'primary',
            firstName: 'Pat',
            lastName: 'Primary',
            email: null,
          },
          {
            id: 'rg-2',
            propertyId: PROPERTY,
            reservationId: RES_A,
            guestId: GUEST_ACC,
            role: 'accompanying',
            firstName: 'Ann',
            lastName: 'Acc',
            email: null,
          },
        ], // source occupants
        [
          {
            id: 'rg-3',
            propertyId: PROPERTY,
            reservationId: RES_B,
            guestId: 'guest-other',
            role: 'primary',
            firstName: 'Other',
            lastName: 'Guest',
            email: null,
          },
        ], // target occupants
        [{ maxOccupancy: 4 }],
      ]);

      db.transaction.mockImplementation(async (cb: any) => {
        const tx = {
          update: vi.fn().mockReturnValue({
            set: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([]),
            }),
          }),
        };
        return cb(tx);
      });

      const result = await svc.moveGuest(RES_A, PROPERTY, GUEST_ACC, {
        targetReservationId: RES_B,
      });
      expect(result.toReservationId).toBe(RES_B);
      expect(webhook.emit).toHaveBeenCalledWith(
        'reservation.guest_moved',
        'reservation',
        RES_A,
        expect.objectContaining({ guestId: GUEST_ACC }),
        PROPERTY,
      );
    });

    it('rejects moves across different bookings', async () => {
      mockSelectSequence([
        [sourceReservation],
        [{ ...sourceReservation, id: RES_B, bookingId: 'other-booking' }],
      ]);
      await expect(
        svc.moveGuest(RES_A, PROPERTY, GUEST_ACC, { targetReservationId: RES_B }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects when the target room type max occupancy is exceeded and no override is given', async () => {
      const target = {
        ...sourceReservation,
        id: RES_B,
        guestId: 'guest-other',
        adults: 1,
      };
      mockSelectSequence([
        [sourceReservation], // source
        [target], // target
        [
          {
            id: 'rg-1',
            propertyId: PROPERTY,
            reservationId: RES_A,
            guestId: GUEST_PRIMARY,
            role: 'primary',
            firstName: 'Pat',
            lastName: 'Primary',
            email: null,
          },
          {
            id: 'rg-2',
            propertyId: PROPERTY,
            reservationId: RES_A,
            guestId: GUEST_ACC,
            role: 'accompanying',
            firstName: 'Ann',
            lastName: 'Acc',
            email: null,
          },
        ], // source occupants
        [
          {
            id: 'rg-3',
            propertyId: PROPERTY,
            reservationId: RES_B,
            guestId: 'guest-other',
            role: 'primary',
            firstName: 'Other',
            lastName: 'Guest',
            email: null,
          },
        ], // target occupants (already 1)
        [{ maxOccupancy: 1 }], // target cap — moving in a 2nd guest exceeds it
      ]);

      await expect(
        svc.moveGuest(RES_A, PROPERTY, GUEST_ACC, { targetReservationId: RES_B }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('skips the target max occupancy check when overrideMaxOccupancy is true', async () => {
      const target = {
        ...sourceReservation,
        id: RES_B,
        guestId: 'guest-other',
        adults: 1,
      };
      mockSelectSequence([
        [sourceReservation], // source
        [target], // target
        [
          {
            id: 'rg-1',
            propertyId: PROPERTY,
            reservationId: RES_A,
            guestId: GUEST_PRIMARY,
            role: 'primary',
            firstName: 'Pat',
            lastName: 'Primary',
            email: null,
          },
          {
            id: 'rg-2',
            propertyId: PROPERTY,
            reservationId: RES_A,
            guestId: GUEST_ACC,
            role: 'accompanying',
            firstName: 'Ann',
            lastName: 'Acc',
            email: null,
          },
        ], // source occupants
        [
          {
            id: 'rg-3',
            propertyId: PROPERTY,
            reservationId: RES_B,
            guestId: 'guest-other',
            role: 'primary',
            firstName: 'Other',
            lastName: 'Guest',
            email: null,
          },
        ], // target occupants
        // No room type cap lookup — assertWithinMaxOccupancy is skipped entirely.
      ]);

      db.transaction.mockImplementation(async (cb: any) => {
        const tx = {
          update: vi.fn().mockReturnValue({
            set: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([]),
            }),
          }),
        };
        return cb(tx);
      });

      const result = await svc.moveGuest(RES_A, PROPERTY, GUEST_ACC, {
        targetReservationId: RES_B,
        overrideMaxOccupancy: true,
      });
      expect(result.toReservationId).toBe(RES_B);
    });
  });

  describe('listGuests', () => {
    it('404s when reservation is missing', async () => {
      mockSelectSequence([[]]);
      await expect(svc.listGuests(RES_A, PROPERTY)).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
