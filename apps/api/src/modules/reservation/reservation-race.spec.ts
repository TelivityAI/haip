import { Test, type TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { ReservationService } from './reservation.service';
import { AvailabilityService } from './availability.service';
import { FolioService } from '../folio/folio.service';
import { RoomStatusService } from '../room/room-status.service';
import { PaymentService } from '../payment/payment.service';
import { WebhookService } from '../webhook/webhook.service';
import { AncillaryService } from '../ancillary/ancillary.service';
import { PolicyService } from '../policy/policy.service';
import { DepositSettlementService } from '../accounting/deposit-settlement.service';
import { DRIZZLE } from '../../database/database.module';

/**
 * Bug 2: state-machine transitions must use a conditional UPDATE so that
 * two concurrent callers that both pass the initial assertTransition() read
 * cannot both flip the status. These tests drive the service through the
 * race case by returning an empty array from .update(...).returning(),
 * which simulates "another request already took the row".
 */

const mockReservation = {
  id: 'res-001',
  propertyId: 'prop-001',
  status: 'pending',
  arrivalDate: '2026-05-01',
  departureDate: '2026-05-03',
  roomTypeId: 'rt-1',
};

const mockWebhookService = { emit: vi.fn().mockResolvedValue(undefined) };
const mockAvailabilityService = { searchAvailability: vi.fn() };
const mockFolioService = {
  createAutoFolio: vi.fn(),
  postCharge: vi.fn(),
  list: vi.fn(),
  findById: vi.fn(),
  settle: vi.fn(),
};
const mockRoomStatusService = { markOccupied: vi.fn(), markVacantDirty: vi.fn() };
const mockPaymentService = {
  authorizePayment: vi.fn(),
  capturePayment: vi.fn(),
  voidPayment: vi.fn(),
};

function createRaceDb(options: {
  reservation?: any;        // Row returned by the initial findByIdRaw select
  claimResult?: any[];      // Rows returned by update(...).returning() — [] simulates lost race
  currentAfterMiss?: any[]; // Rows returned by the post-miss select — shows actual state
} = {}) {
  const reservation = options.reservation ?? mockReservation;
  const claimResult = options.claimResult ?? [];
  const currentAfterMiss = options.currentAfterMiss ?? [{ ...reservation, status: 'cancelled' }];

  let selectCallCount = 0;
  return {
    select: vi.fn().mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          then: (resolve: any) => {
            selectCallCount++;
            // 1st select = findByIdRaw, 2nd = post-miss current-status lookup
            if (selectCallCount === 1) resolve([reservation]);
            else resolve(currentAfterMiss);
          },
        }),
      }),
    })),
    insert: vi.fn(),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue(claimResult),
        }),
      }),
    }),
    delete: vi.fn(),
    transaction: vi.fn(),
  };
}

async function createService(db: any) {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      ReservationService,
      { provide: DRIZZLE, useValue: db },
      { provide: AvailabilityService, useValue: mockAvailabilityService },
      { provide: FolioService, useValue: mockFolioService },
      { provide: RoomStatusService, useValue: mockRoomStatusService },
      { provide: PaymentService, useValue: mockPaymentService },
      { provide: WebhookService, useValue: mockWebhookService },
      { provide: AncillaryService, useValue: { ensurePackageComponents: async () => [], postOnceForReservation: async () => ({ posted: [] }) } },
      { provide: PolicyService, useValue: { evaluateCancellation: async () => ({ withinFreeWindow: true, penaltyAmount: '0.00', depositAction: 'refund', policyDescription: 'test', policyId: null, policyCode: null, penaltyType: 'none' }) } },
      { provide: DepositSettlementService, useValue: { settleFromEvaluation: async () => null, applyHeldDeposits: async () => [] } },
    ],
  }).compile();
  return module.get<ReservationService>(ReservationService);
}

describe('ReservationService — conditional-update race (Bug 2)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('confirm raises ConflictException when the claim returns no rows', async () => {
    // State machine lets pending → confirmed. The conditional UPDATE returns
    // [] (another caller already flipped the row), so service should look up
    // the current state and raise ConflictException — NOT silently succeed.
    const db = createRaceDb({
      reservation: { ...mockReservation, status: 'pending' },
      claimResult: [],
      currentAfterMiss: [{ ...mockReservation, status: 'confirmed' }],
    });
    const svc = await createService(db);
    await expect(svc.confirm('res-001', 'prop-001')).rejects.toThrow(
      ConflictException,
    );
  });

  it('cancel raises ConflictException when a concurrent cancel wins', async () => {
    const db = createRaceDb({
      reservation: { ...mockReservation, status: 'confirmed' },
      claimResult: [],
      currentAfterMiss: [{ ...mockReservation, status: 'cancelled' }],
    });
    const svc = await createService(db);
    await expect(
      svc.cancel('res-001', 'prop-001', { cancellationReason: 'test' }),
    ).rejects.toThrow(ConflictException);
  });

  it('cancel raises NotFoundException when the row has vanished', async () => {
    const db = createRaceDb({
      reservation: { ...mockReservation, status: 'confirmed' },
      claimResult: [],
      currentAfterMiss: [], // row is gone entirely
    });
    const svc = await createService(db);
    await expect(
      svc.cancel('res-001', 'prop-001', { cancellationReason: 'test' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('markNoShow raises ConflictException when claim misses', async () => {
    const db = createRaceDb({
      reservation: { ...mockReservation, status: 'confirmed' },
      claimResult: [],
      currentAfterMiss: [{ ...mockReservation, status: 'cancelled' }],
    });
    const svc = await createService(db);
    await expect(svc.markNoShow('res-001', 'prop-001')).rejects.toThrow(
      ConflictException,
    );
  });

  it('confirm succeeds (returns the claimed row) when no race happens', async () => {
    const confirmed = { ...mockReservation, status: 'confirmed' };
    const db = createRaceDb({
      reservation: { ...mockReservation, status: 'pending' },
      claimResult: [confirmed],
    });
    const svc = await createService(db);
    const result = await svc.confirm('res-001', 'prop-001');
    expect(result.status).toBe('confirmed');
  });
});
