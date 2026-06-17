import { Test, TestingModule } from '@nestjs/testing';
import { RoomingListService } from './rooming-list.service';
import { WebhookService } from '../webhook/webhook.service';
import { ReservationService } from '../reservation/reservation.service';
import { AllotmentService } from './allotment.service';
import { GroupProfileService } from './group-profile.service';
import { DRIZZLE } from '../../database/database.module';

const mockBlock = {
  id: 'block-001',
  propertyId: 'prop-001',
  groupProfileId: 'grp-001',
  ratePlanId: 'rate-001',
  startDate: '2026-06-01',
  endDate: '2026-06-04',
  status: 'tentative',
};

function createMockDb() {
  // Each insert returns a fresh entry row; updates resolve.
  // FK-ownership check on roomTypes runs before insert per row — return a row so
  // the existing tests reach the booking-creation path under test.
  let entrySeq = 0;
  return {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ id: 'rt-1' }]),
      }),
    }),
    insert: vi.fn().mockImplementation(() => ({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockImplementation(() => {
          entrySeq++;
          return Promise.resolve([{ id: `entry-${entrySeq}`, status: 'pending' }]);
        }),
      }),
    })),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
    }),
    delete: vi.fn(),
  };
}

const mockWebhookService = { emit: vi.fn() };

async function buildService(opts: { reservationCreate: any }) {
  const db = createMockDb();
  const mockReservationService = {
    create: opts.reservationCreate,
  } as unknown as ReservationService;
  const mockAllotmentService = {
    findBlockById: vi.fn().mockResolvedValue(mockBlock),
    incrementPickup: vi.fn().mockResolvedValue({}),
  } as unknown as AllotmentService;
  const mockGroupProfileService = {
    linkReservation: vi.fn().mockResolvedValue({}),
  } as unknown as GroupProfileService;

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      RoomingListService,
      { provide: DRIZZLE, useValue: db },
      { provide: WebhookService, useValue: mockWebhookService },
      { provide: ReservationService, useValue: mockReservationService },
      { provide: AllotmentService, useValue: mockAllotmentService },
      { provide: GroupProfileService, useValue: mockGroupProfileService },
    ],
  }).compile();
  return {
    svc: module.get<RoomingListService>(RoomingListService),
    mockAllotmentService,
    mockGroupProfileService,
  };
}

describe('RoomingListService.importRoomingList', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates a reservation for a valid row and increments pickup', async () => {
    const { svc, mockAllotmentService, mockGroupProfileService } = await buildService({
      reservationCreate: vi.fn().mockResolvedValue({ id: 'res-001' }),
    });
    const result = await svc.importRoomingList('block-001', 'prop-001', {
      propertyId: 'prop-001',
      entries: [
        { guestName: 'Jane Doe', guestId: 'guest-001', roomTypeId: 'rt-001', totalAmount: '500.00', currencyCode: 'USD' },
      ],
    });
    expect(result.created).toBe(1);
    expect(result.errors).toBe(0);
    expect(mockAllotmentService.incrementPickup).toHaveBeenCalled();
    expect(mockGroupProfileService.linkReservation).toHaveBeenCalledWith(
      'grp-001',
      'prop-001',
      'res-001',
    );
    expect(mockWebhookService.emit).toHaveBeenCalledWith(
      'group.rooming_list_imported',
      'allotment_block',
      'block-001',
      expect.objectContaining({ created: 1, errors: 0 }),
      'prop-001',
    );
  });

  it('flags a row missing a guest as error without aborting the batch', async () => {
    const { svc } = await buildService({
      reservationCreate: vi.fn().mockResolvedValue({ id: 'res-002' }),
    });
    const result = await svc.importRoomingList('block-001', 'prop-001', {
      propertyId: 'prop-001',
      entries: [
        { guestName: 'No Guest', roomTypeId: 'rt-001' }, // no guestId -> error
        { guestName: 'Jane Doe', guestId: 'guest-001', roomTypeId: 'rt-001' },
      ],
    });
    expect(result.total).toBe(2);
    expect(result.created).toBe(1);
    expect(result.errors).toBe(1);
    const errorRow = result.results.find((r: any) => r.status === 'error');
    expect(errorRow.error).toContain('guest required');
  });

  it('flags a reservation creation failure as error', async () => {
    const { svc } = await buildService({
      reservationCreate: vi.fn().mockRejectedValue(new Error('No availability')),
    });
    const result = await svc.importRoomingList('block-001', 'prop-001', {
      propertyId: 'prop-001',
      entries: [{ guestName: 'Jane', guestId: 'guest-001', roomTypeId: 'rt-001' }],
    });
    expect(result.created).toBe(0);
    expect(result.errors).toBe(1);
  });
});
