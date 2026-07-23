import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
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

const mockReservation = {
  id: 'res-001',
  propertyId: 'prop-001',
  bookingId: 'book-001',
  guestId: 'guest-001',
  roomTypeId: 'rt-001',
  roomId: 'room-001',
  status: 'assigned',
  totalAmount: '500.00',
  currencyCode: 'USD',
  specialRequests: null,
  arrivalDate: '2026-04-06',
  departureDate: '2026-04-08',
  nights: 2,
};

const mockGuest = {
  id: 'guest-001',
  isDnr: false,
};

const mockRoom = {
  id: 'room-001',
  roomTypeId: 'rt-001',
  status: 'guest_ready',
  propertyId: 'prop-001',
};

const mockProperty = {
  id: 'prop-001',
  checkInTime: '15:00',
  checkOutTime: '11:00',
  timezone: 'UTC',
  settings: null,
};

const mockFolio = {
  id: 'folio-001',
  propertyId: 'prop-001',
  reservationId: 'res-001',
  status: 'open',
  balance: '0.00',
};

const mockUpdatedReservation = {
  ...mockReservation,
  status: 'checked_in',
  checkedInAt: new Date(),
  actualArrivalTime: new Date(),
};

const mockFolioService = {
  createAutoFolio: vi.fn().mockResolvedValue(mockFolio),
  postCharge: vi.fn().mockResolvedValue({}),
  list: vi.fn().mockResolvedValue({ data: [mockFolio] }),
  findById: vi.fn().mockResolvedValue(mockFolio),
  settle: vi.fn(),
};

const mockRoomStatusService = {
  markOccupied: vi.fn().mockResolvedValue({ ...mockRoom, status: 'occupied' }),
  markVacantDirty: vi.fn(),
};

const mockPaymentService = {
  authorizePayment: vi.fn().mockResolvedValue({ id: 'pay-001', status: 'authorized' }),
  capturePayment: vi.fn(),
  voidPayment: vi.fn(),
};

const mockWebhookService = { emit: vi.fn() };
const mockAvailabilityService = { searchAvailability: vi.fn() };

// Helper to build a mock DB for check-in tests
// Call sequence: 1=reservation, 2=guest, 3=property (optional: 4=room if override)
function createCheckInDb(options: {
  reservation?: any;
  guest?: any;
  property?: any;
  room?: any;
} = {}) {
  const res = options.reservation ?? mockReservation;
  const guest = options.guest ?? mockGuest;
  const property = options.property ?? mockProperty;
  const room = options.room ?? mockRoom;

  let callCount = 0;
  // Call sequence when no dto.roomId: 1=reservation, 2=guest, 3=property
  // Room override tests use custom inline mocks
  return {
    select: vi.fn().mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          then: (resolve: any) => {
            callCount++;
            if (callCount === 1) resolve([res]);
            else if (callCount === 2) resolve([guest]);
            else if (callCount === 3) resolve([property]);
            else resolve([]);
          },
        }),
        leftJoin: vi.fn().mockReturnValue({
          leftJoin: vi.fn().mockReturnValue({
            leftJoin: vi.fn().mockReturnValue({
              leftJoin: vi.fn().mockReturnValue({
                where: vi.fn().mockResolvedValue([{ reservation: res }]),
              }),
            }),
          }),
        }),
      }),
    })),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{}]),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([mockUpdatedReservation]),
        }),
      }),
    }),
    delete: vi.fn(),
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

describe('ReservationService — checkIn', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFolioService.createAutoFolio.mockResolvedValue(mockFolio);
    mockPaymentService.authorizePayment.mockResolvedValue({ id: 'pay-001', status: 'authorized' });
  });

  it('should transition state to checked_in', async () => {
    const db = createCheckInDb();
    const svc = await createService(db);
    const result = await svc.checkIn('res-001', 'prop-001');
    expect(result.reservation.status).toBe('checked_in');
  });

  it('should set checkedInAt and actualArrivalTime', async () => {
    const db = createCheckInDb();
    const svc = await createService(db);
    const result = await svc.checkIn('res-001', 'prop-001');
    expect(result.reservation.checkedInAt).toBeDefined();
    expect(result.reservation.actualArrivalTime).toBeDefined();
  });

  it('should create auto-folio', async () => {
    const db = createCheckInDb();
    const svc = await createService(db);
    await svc.checkIn('res-001', 'prop-001');
    expect(mockFolioService.createAutoFolio).toHaveBeenCalled();
  });

  it('should mark room occupied', async () => {
    const db = createCheckInDb();
    const svc = await createService(db);
    await svc.checkIn('res-001', 'prop-001');
    expect(mockRoomStatusService.markOccupied).toHaveBeenCalledWith('room-001', 'prop-001');
  });

  it('should emit reservation.checked_in webhook', async () => {
    const db = createCheckInDb();
    const svc = await createService(db);
    await svc.checkIn('res-001', 'prop-001');
    expect(mockWebhookService.emit).toHaveBeenCalledWith(
      'reservation.checked_in',
      'reservation',
      expect.any(String),
      expect.objectContaining({ roomId: 'room-001', folioId: 'folio-001' }),
      'prop-001',
    );
  });

  it('should store encrypted guestIdDocument when ID provided', async () => {
    const db = createCheckInDb();
    const svc = await createService(db);
    await svc.checkIn('res-001', 'prop-001', {
      idType: 'passport',
      idNumber: 'AB123456',
      idCountry: 'US',
      idExpiry: '2030-01-01',
    });
    // Verify update was called with guestIdDocument
    const updateCall = db.update.mock.results[0].value.set.mock.calls[0][0];
    expect(updateCall.guestIdDocument).toBeDefined();
    expect(updateCall.guestIdDocument.type).toBe('passport');
    expect(updateCall.guestIdDocument.encryptedNumber).toBeDefined();
    // Should not store plain text
    expect(updateCall.guestIdDocument.encryptedNumber).not.toBe('AB123456');
  });

  it('should validate room type when roomId override provided', async () => {
    const wrongRoom = { ...mockRoom, id: 'room-002', roomTypeId: 'rt-999' };
    // Need: 1=reservation, 2=guest, 3=wrong room (for override lookup)
    let callCount = 0;
    const db = {
      select: vi.fn().mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            then: (resolve: any) => {
              callCount++;
              if (callCount === 1) resolve([mockReservation]);
              else if (callCount === 2) resolve([mockGuest]);
              else if (callCount === 3) resolve([wrongRoom]);
              else resolve([mockProperty]);
            },
          }),
        }),
      })),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([mockUpdatedReservation]),
          }),
        }),
      }),
    };
    const svc = await createService(db);
    await expect(svc.checkIn('res-001', 'prop-001', { roomId: 'room-002' })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('should validate room status when roomId override provided', async () => {
    const occupiedRoom = { ...mockRoom, id: 'room-002', status: 'occupied' };
    let callCount = 0;
    const db = {
      select: vi.fn().mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            then: (resolve: any) => {
              callCount++;
              if (callCount === 1) resolve([mockReservation]);
              else if (callCount === 2) resolve([mockGuest]);
              else if (callCount === 3) resolve([occupiedRoom]);
              else resolve([mockProperty]);
            },
          }),
        }),
      })),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([mockUpdatedReservation]),
          }),
        }),
      }),
    };
    const svc = await createService(db);
    await expect(svc.checkIn('res-001', 'prop-001', { roomId: 'room-002' })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('should throw when no room assigned and no roomId provided', async () => {
    const noRoomRes = { ...mockReservation, roomId: null };
    // 1=reservation (no room), 2=guest, 3=property
    let callCount = 0;
    const db = {
      select: vi.fn().mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            then: (resolve: any) => {
              callCount++;
              if (callCount === 1) resolve([noRoomRes]);
              else if (callCount === 2) resolve([mockGuest]);
              else resolve([mockProperty]);
            },
          }),
        }),
      })),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([mockUpdatedReservation]),
          }),
        }),
      }),
    };
    const svc = await createService(db);
    await expect(svc.checkIn('res-001', 'prop-001')).rejects.toThrow(BadRequestException);
  });

  it('should reject DNR guest', async () => {
    const dnrGuest = { ...mockGuest, isDnr: true };
    const db = createCheckInDb({ guest: dnrGuest });
    const svc = await createService(db);
    await expect(svc.checkIn('res-001', 'prop-001')).rejects.toThrow(BadRequestException);
  });

  it('should call paymentService.authorizePayment when token provided', async () => {
    const db = createCheckInDb();
    const svc = await createService(db);
    await svc.checkIn('res-001', 'prop-001', {
      gatewayPaymentToken: 'tok_test_123',
      gatewayProvider: 'stripe',
    });
    expect(mockPaymentService.authorizePayment).toHaveBeenCalledWith(
      expect.objectContaining({
        folioId: 'folio-001',
        gatewayPaymentToken: 'tok_test_123',
      }),
    );
  });

  it('should skip deposit auth when skipDepositAuth is true', async () => {
    const db = createCheckInDb();
    const svc = await createService(db);
    await svc.checkIn('res-001', 'prop-001', {
      skipDepositAuth: true,
      gatewayPaymentToken: 'tok_test_123',
    });
    expect(mockPaymentService.authorizePayment).not.toHaveBeenCalled();
  });

  it('should not block check-in when deposit auth fails', async () => {
    mockPaymentService.authorizePayment.mockRejectedValue(
      new BadRequestException('Authorization failed'),
    );
    const db = createCheckInDb();
    const svc = await createService(db);
    const result = await svc.checkIn('res-001', 'prop-001', {
      gatewayPaymentToken: 'tok_test_fail',
      gatewayProvider: 'stripe',
    });
    expect(result.reservation.status).toBe('checked_in');
    expect(result.depositAuth).toBeNull();
  });

  it('should set early check-in flag when before standard time', async () => {
    // Make property check-in time far in the future so "now" is always early
    const earlyProperty = { ...mockProperty, checkInTime: '23:59', settings: { earlyCheckInFee: 50 } };
    const db = createCheckInDb({ property: earlyProperty });
    const svc = await createService(db);
    const result = await svc.checkIn('res-001', 'prop-001');
    const updateCall = db.update.mock.results[0].value.set.mock.calls[0][0];
    expect(updateCall.isEarlyCheckin).toBe(true);
  });

  it('should post early check-in fee to folio', async () => {
    const earlyProperty = { ...mockProperty, checkInTime: '23:59', settings: { earlyCheckInFee: 50 } };
    const db = createCheckInDb({ property: earlyProperty });
    const svc = await createService(db);
    await svc.checkIn('res-001', 'prop-001');
    expect(mockFolioService.postCharge).toHaveBeenCalledWith(
      'folio-001',
      expect.objectContaining({
        type: 'fee',
        description: 'Early check-in fee',
        amount: '50',
      }),
    );
  });
});
