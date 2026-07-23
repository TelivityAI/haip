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

const PROPERTY = 'aaaaaaaa-0000-4000-a000-000000000001';
const RATE_PLAN = 'rp-001';
const ROOM_TYPE = 'rt-001';

function mkDb() {
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
    searchAvailability: vi.fn().mockResolvedValue([{ roomTypeId: ROOM_TYPE, available: 2 }]),
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
});
