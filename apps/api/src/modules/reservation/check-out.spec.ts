import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
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
  guestId: 'guest-001',
  roomId: 'room-001',
  status: 'checked_in',
  totalAmount: '500.00',
  currencyCode: 'USD',
};

const mockProperty = {
  id: 'prop-001',
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
  folioNumber: 'F-260406-0001',
};

const mockUpdatedReservation = {
  ...mockReservation,
  status: 'checked_out',
  checkedOutAt: new Date(),
  actualDepartureTime: new Date(),
};

const mockFolioService = {
  createAutoFolio: vi.fn(),
  postCharge: vi.fn().mockResolvedValue({}),
  list: vi.fn().mockResolvedValue({ data: [mockFolio] }),
  findById: vi.fn().mockResolvedValue(mockFolio),
  settle: vi.fn().mockResolvedValue({ ...mockFolio, status: 'settled' }),
};

const mockRoomStatusService = {
  markOccupied: vi.fn(),
  markVacantDirty: vi.fn().mockResolvedValue({ status: 'vacant_dirty' }),
};

const mockPaymentService = {
  authorizePayment: vi.fn(),
  capturePayment: vi.fn().mockResolvedValue({ id: 'pay-001', status: 'captured' }),
  voidPayment: vi.fn().mockResolvedValue({ id: 'pay-001', status: 'voided' }),
};

const mockWebhookService = { emit: vi.fn() };
const mockAvailabilityService = { searchAvailability: vi.fn() };

function createCheckOutDb(options: {
  reservation?: any;
  property?: any;
  authorizedPayments?: any[];
} = {}) {
  const res = options.reservation ?? mockReservation;
  const property = options.property ?? mockProperty;
  const authorizedPayments = options.authorizedPayments ?? [];

  let callCount = 0;
  return {
    select: vi.fn().mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          then: (resolve: any) => {
            callCount++;
            if (callCount === 1) resolve([res]); // findByIdRaw
            else if (callCount === 2) resolve([property]); // property lookup
            else resolve(authorizedPayments); // authorized payments query
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

describe('ReservationService — checkOut', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFolioService.list.mockResolvedValue({ data: [mockFolio] });
    mockFolioService.findById.mockResolvedValue(mockFolio);
  });

  it('should transition state to checked_out', async () => {
    const db = createCheckOutDb();
    const svc = await createService(db);
    const result = await svc.checkOut('res-001', 'prop-001');
    expect(result.reservation.status).toBe('checked_out');
  });

  it('should set checkedOutAt and actualDepartureTime', async () => {
    const db = createCheckOutDb();
    const svc = await createService(db);
    const result = await svc.checkOut('res-001', 'prop-001');
    expect(result.reservation.checkedOutAt).toBeDefined();
    expect(result.reservation.actualDepartureTime).toBeDefined();
  });

  it('should mark room vacant_dirty', async () => {
    const db = createCheckOutDb();
    const svc = await createService(db);
    await svc.checkOut('res-001', 'prop-001');
    expect(mockRoomStatusService.markVacantDirty).toHaveBeenCalledWith('room-001', 'prop-001');
  });

  it('should emit reservation.checked_out webhook', async () => {
    // Use far-future checkout time to ensure it's never late
    const notLateProperty = { ...mockProperty, checkOutTime: '23:59' };
    const db = createCheckOutDb({ property: notLateProperty });
    const svc = await createService(db);
    await svc.checkOut('res-001', 'prop-001');
    expect(mockWebhookService.emit).toHaveBeenCalledWith(
      'reservation.checked_out',
      'reservation',
      expect.any(String),
      expect.objectContaining({ isLateCheckout: false }),
      'prop-001',
    );
  });

  it('should capture pre-auths on express checkout', async () => {
    const authPayment = { id: 'pay-auth-001', folioId: 'folio-001', status: 'authorized', propertyId: 'prop-001' };
    const db = createCheckOutDb({ authorizedPayments: [authPayment] });
    const svc = await createService(db);
    await svc.checkOut('res-001', 'prop-001', { expressCheckout: true });
    expect(mockPaymentService.capturePayment).toHaveBeenCalledWith('pay-auth-001', 'prop-001');
  });

  it('should settle zero-balance folios on express checkout', async () => {
    const db = createCheckOutDb();
    const svc = await createService(db);
    await svc.checkOut('res-001', 'prop-001', { expressCheckout: true });
    expect(mockFolioService.settle).toHaveBeenCalledWith('folio-001', 'prop-001');
  });

  it('should post late checkout fee before express checkout settles', async () => {
    const lateProperty = { ...mockProperty, checkOutTime: '00:01', settings: { lateCheckoutFee: 75 } };
    const db = createCheckOutDb({ property: lateProperty });
    const svc = await createService(db);
    const callOrder: string[] = [];
    mockFolioService.postCharge.mockImplementation(async () => {
      callOrder.push('postCharge');
    });
    mockFolioService.settle.mockImplementation(async () => {
      callOrder.push('settle');
    });

    await svc.checkOut('res-001', 'prop-001', { expressCheckout: true });

    expect(mockFolioService.postCharge).toHaveBeenCalledWith(
      'folio-001',
      expect.objectContaining({ type: 'fee', amount: '75' }),
    );
    expect(callOrder).toEqual(['postCharge', 'settle']);
  });

  it('should throw on express checkout with outstanding balance', async () => {
    mockFolioService.findById.mockResolvedValue({ ...mockFolio, balance: '150.00' });
    const db = createCheckOutDb();
    const svc = await createService(db);
    await expect(
      svc.checkOut('res-001', 'prop-001', { expressCheckout: true }),
    ).rejects.toThrow(BadRequestException);
  });

  it('should set late checkout flag when after standard time', async () => {
    // Set checkout time far in the past so "now" is always late
    const lateProperty = { ...mockProperty, checkOutTime: '00:01' };
    const db = createCheckOutDb({ property: lateProperty });
    const svc = await createService(db);
    const result = await svc.checkOut('res-001', 'prop-001');
    const updateCall = db.update.mock.results[0].value.set.mock.calls[0][0];
    expect(updateCall.isLateCheckout).toBe(true);
  });

  it('should post late checkout fee to folio', async () => {
    const lateProperty = { ...mockProperty, checkOutTime: '00:01', settings: { lateCheckoutFee: 75 } };
    const db = createCheckOutDb({ property: lateProperty });
    const svc = await createService(db);
    await svc.checkOut('res-001', 'prop-001');
    expect(mockFolioService.postCharge).toHaveBeenCalledWith(
      'folio-001',
      expect.objectContaining({
        type: 'fee',
        description: 'Late checkout fee',
        amount: '75',
      }),
    );
  });

  it('should void remaining pre-auths on non-express checkout', async () => {
    const authPayment = { id: 'pay-auth-001', folioId: 'folio-001', status: 'authorized', propertyId: 'prop-001' };
    const db = createCheckOutDb({ authorizedPayments: [authPayment] });
    const svc = await createService(db);
    await svc.checkOut('res-001', 'prop-001');
    expect(mockPaymentService.voidPayment).toHaveBeenCalledWith('pay-auth-001', 'prop-001');
  });

  it('should throw on non-express checkout with outstanding balance', async () => {
    mockFolioService.list.mockResolvedValue({
      data: [{ ...mockFolio, balance: '150.00' }],
    });
    mockFolioService.findById.mockResolvedValue({ ...mockFolio, balance: '150.00' });
    const db = createCheckOutDb();
    const svc = await createService(db);
    await expect(svc.checkOut('res-001', 'prop-001')).rejects.toThrow(BadRequestException);
  });

  it('should work from stayover state', async () => {
    const stayoverRes = { ...mockReservation, status: 'stayover' };
    const db = createCheckOutDb({ reservation: stayoverRes });
    const svc = await createService(db);
    const result = await svc.checkOut('res-001', 'prop-001');
    expect(result.reservation.status).toBe('checked_out');
  });
});
