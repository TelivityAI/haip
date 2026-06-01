import { Test, TestingModule } from '@nestjs/testing';
import { ReservationService } from './reservation.service';
import { AvailabilityService } from './availability.service';
import { FolioService } from '../folio/folio.service';
import { RoomStatusService } from '../room/room-status.service';
import { PaymentService } from '../payment/payment.service';
import { WebhookService } from '../webhook/webhook.service';
import { DRIZZLE } from '../../database/database.module';

const mockWebhookService = { emit: vi.fn() };

// Minimal db mock for findUnassigned: leftJoin chain + count.
function createUnassignedDb(rows: any[]) {
  return {
    select: vi.fn().mockImplementation((shape: any) => {
      // count query has a `count` key
      if (shape && 'count' in shape) {
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([{ count: rows.length }]),
          }),
        };
      }
      return {
        from: vi.fn().mockReturnValue({
          leftJoin: vi.fn().mockReturnValue({
            leftJoin: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                orderBy: vi.fn().mockResolvedValue(rows),
              }),
            }),
          }),
        }),
      };
    }),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    transaction: vi.fn(),
  };
}

async function createService(db: any) {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      ReservationService,
      { provide: DRIZZLE, useValue: db },
      { provide: AvailabilityService, useValue: { searchAvailability: vi.fn() } },
      { provide: FolioService, useValue: {} },
      { provide: RoomStatusService, useValue: {} },
      { provide: PaymentService, useValue: {} },
      { provide: WebhookService, useValue: mockWebhookService },
    ],
  }).compile();
  return module.get<ReservationService>(ReservationService);
}

describe('ReservationService — findUnassigned', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns room-less reservations with a reason hint', async () => {
    const row = {
      reservation: { id: 'res-001', propertyId: 'prop-001', roomId: null, status: 'confirmed', arrivalDate: '2026-06-01' },
      guestFirstName: 'Ada',
      guestLastName: 'Lovelace',
      roomTypeName: 'Deluxe King',
    };
    const svc = await createService(createUnassignedDb([row]));

    const result = await svc.findUnassigned({ propertyId: 'prop-001' });
    expect(result.total).toBe(1);
    expect(result.data[0]).toMatchObject({
      id: 'res-001',
      guestName: 'Ada Lovelace',
      roomTypeName: 'Deluxe King',
      reasonHint: 'no_room_assigned',
    });
  });

  it('returns empty when none unassigned', async () => {
    const svc = await createService(createUnassignedDb([]));
    const result = await svc.findUnassigned({ propertyId: 'prop-001', from: '2026-06-01', to: '2026-06-30' });
    expect(result.total).toBe(0);
    expect(result.data).toEqual([]);
  });
});

describe('ReservationService — bulkAction', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reuses per-id methods and collects mixed results without aborting', async () => {
    const svc = await createService(createUnassignedDb([]));
    // Spy the existing per-reservation methods.
    vi.spyOn(svc, 'cancel').mockImplementation(async (id: string) => {
      if (id === 'res-bad') throw new Error('Cannot transition');
      return { id } as any;
    });

    const result = await svc.bulkAction('prop-001', {
      ids: ['res-001', 'res-bad', 'res-002'],
      action: 'cancel',
      reason: 'guest cancelled',
    });

    expect(result.succeeded).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.results.find((r) => r.id === 'res-bad')).toMatchObject({ success: false });
    expect(mockWebhookService.emit).toHaveBeenCalledWith(
      'reservation.bulk_action_completed',
      'reservation',
      'prop-001',
      expect.objectContaining({ action: 'cancel', succeeded: 2, failed: 1 }),
      'prop-001',
    );
  });

  it('captures check_out balance error per-id as a failure', async () => {
    const svc = await createService(createUnassignedDb([]));
    vi.spyOn(svc, 'checkOut').mockRejectedValue(new Error('outstanding balance of 50.00'));

    const result = await svc.bulkAction('prop-001', { ids: ['res-001'], action: 'check_out' });
    expect(result.failed).toBe(1);
    expect(result.results[0]!.error).toContain('outstanding balance');
  });
});

describe('ReservationService — KB §14.8 deliberate non-feature', () => {
  it('has no un-cancel / reactivate method', async () => {
    const svc = await createService(createUnassignedDb([]));
    expect((svc as any).uncancel).toBeUndefined();
    expect((svc as any).reactivate).toBeUndefined();
    expect((svc as any).unCancel).toBeUndefined();
  });
});
