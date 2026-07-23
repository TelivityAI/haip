import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { WEBHOOK_EVENTS } from '@telivityhaip/shared';
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
};

const mockUpdatedReservation = {
  ...mockReservation,
  registrationSignedAt: new Date(),
  registrationSubmittedAt: new Date(),
  guestIdDocument: {
    type: 'passport',
    encryptedNumber: '***REDACTED***',
    iv: '',
    authTag: '',
    country: 'US',
    expiry: '2030-01-01',
  },
};

const mockWebhookService = { emit: vi.fn() };

function createPreRegisterDb(reservation: any = mockReservation, updated = mockUpdatedReservation) {
  return {
    select: vi.fn().mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockImplementation(() => {
          const chain = {
            then: (resolve: (v: unknown) => void) => resolve([reservation]),
          };
          return chain;
        }),
      }),
    })),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([updated]),
        }),
      }),
    }),
  };
}

async function createService(db: any) {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      ReservationService,
      { provide: DRIZZLE, useValue: db },
      { provide: AvailabilityService, useValue: {} },
      { provide: FolioService, useValue: {} },
      { provide: RoomStatusService, useValue: {} },
      { provide: PaymentService, useValue: {} },
      { provide: WebhookService, useValue: mockWebhookService },
      { provide: AncillaryService, useValue: {} },
      { provide: PolicyService, useValue: {} },
      { provide: DepositSettlementService, useValue: {} },
    ],
  }).compile();
  return module.get<ReservationService>(ReservationService);
}

describe('ReservationService.preRegister', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reservation.pre_registered is in WEBHOOK_EVENTS catalog', () => {
    expect(WEBHOOK_EVENTS['reservation.pre_registered']).toBe('reservation.pre_registered');
  });

  it('persists registration fields without changing status', async () => {
    const db = createPreRegisterDb();
    const svc = await createService(db);

    const result = await svc.preRegister('res-001', 'prop-001', {
      registrationSigned: true,
      registrationData: { signature: 'Jane Doe' },
      idType: 'passport',
      idNumber: 'P1234567',
      idCountry: 'US',
      idExpiry: '2030-01-01',
    });

    expect(result).toEqual(mockUpdatedReservation);
    expect(db.update).toHaveBeenCalled();
    expect(mockWebhookService.emit).toHaveBeenCalledWith(
      'reservation.pre_registered',
      'reservation',
      'res-001',
      expect.objectContaining({
        registrationSigned: true,
        hasRegistrationData: true,
        hasIdDocument: true,
      }),
      'prop-001',
    );
  });

  it('allows confirmed reservations', async () => {
    const confirmed = { ...mockReservation, status: 'confirmed' };
    const db = createPreRegisterDb(confirmed, { ...confirmed, registrationSignedAt: new Date() });
    const svc = await createService(db);

    await expect(
      svc.preRegister('res-001', 'prop-001', { registrationSigned: true }),
    ).resolves.toBeDefined();
  });

  it('rejects when reservation not found', async () => {
    const db = createPreRegisterDb(null as any);
    db.select = vi.fn().mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockImplementation(() => ({
          then: (resolve: (v: unknown) => void) => resolve([]),
        })),
      }),
    }));
    const svc = await createService(db);

    await expect(
      svc.preRegister('res-001', 'prop-001', { registrationSigned: true }),
    ).rejects.toThrow(NotFoundException);
  });

  it('rejects when status is not confirmed or assigned', async () => {
    const checkedIn = { ...mockReservation, status: 'checked_in' };
    const db = createPreRegisterDb(checkedIn);
    const svc = await createService(db);

    await expect(
      svc.preRegister('res-001', 'prop-001', { registrationSigned: true }),
    ).rejects.toThrow(BadRequestException);
  });
});
