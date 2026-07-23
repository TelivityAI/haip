import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { AncillaryService } from './ancillary.service';
import { FolioService } from '../folio/folio.service';
import { WebhookService } from '../webhook/webhook.service';
import { DRIZZLE } from '../../database/database.module';

const mockService = {
  id: 'svc-001',
  propertyId: 'prop-001',
  code: 'BREAKFAST',
  name: 'Breakfast Buffet',
  description: null,
  chargeType: 'food_beverage',
  price: '25.00',
  currencyCode: 'USD',
  taxCode: null,
  postingRule: 'once',
  sellChannels: ['front_desk'],
  isActive: true,
  sortOrder: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockReservation = {
  id: 'res-001',
  propertyId: 'prop-001',
  guestId: 'guest-001',
  ratePlanId: 'rp-001',
  arrivalDate: '2026-07-23',
  departureDate: '2026-07-25',
  status: 'checked_in',
  currencyCode: 'USD',
};

const mockRs = {
  id: 'rs-001',
  propertyId: 'prop-001',
  reservationId: 'res-001',
  serviceId: 'svc-001',
  quantity: 1,
  unitPrice: '25.00',
  currencyCode: 'USD',
  status: 'confirmed',
  sourceChannel: 'front_desk',
  postingRule: 'once',
  chargeType: 'food_beverage',
  notes: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function chainResolving(returnData: any[]) {
  return () => ({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockReturnValue({
          offset: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue(returnData),
          }),
          then: (resolve: any) => resolve(returnData),
        }),
        orderBy: vi.fn().mockResolvedValue(returnData),
        then: (resolve: any) => resolve(returnData),
      }),
      innerJoin: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(returnData),
      }),
    }),
  });
}

function mutateResolving(returnData: any[]) {
  return () => ({
    values: vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue(returnData),
    }),
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue(returnData),
      }),
    }),
    where: vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue(returnData),
    }),
  });
}

const mockWebhookService = { emit: vi.fn() };
const mockFolioService = { postCharge: vi.fn() };

async function buildService(db: any) {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      AncillaryService,
      { provide: DRIZZLE, useValue: db },
      { provide: FolioService, useValue: mockFolioService },
      { provide: WebhookService, useValue: mockWebhookService },
    ],
  }).compile();
  return module.get<AncillaryService>(AncillaryService);
}

describe('AncillaryService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('findServiceById (multi-tenancy)', () => {
    it('throws NotFound when scoped propertyId does not match', async () => {
      const db = {
        select: vi.fn().mockImplementation(chainResolving([])),
        insert: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      };
      const svc = await buildService(db);
      await expect(svc.findServiceById('svc-001', 'other-prop')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns the service when propertyId matches', async () => {
      const db = {
        select: vi.fn().mockImplementation(chainResolving([mockService])),
        insert: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      };
      const svc = await buildService(db);
      const result = await svc.findServiceById('svc-001', 'prop-001');
      expect(result.code).toBe('BREAKFAST');
    });
  });

  describe('attachToReservation (multi-tenancy)', () => {
    it('throws when service belongs to another property', async () => {
      const selectImpls = [
        chainResolving([mockReservation])(), // findReservation
        chainResolving([])(), // findServiceById -> cross-property miss
      ];
      let call = 0;
      const db = {
        select: vi.fn().mockImplementation(() => selectImpls[call++] ?? chainResolving([])()),
        insert: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      };
      const svc = await buildService(db);
      await expect(
        svc.attachToReservation('res-001', {
          propertyId: 'prop-001',
          serviceId: 'svc-other',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('snapshots price/postingRule/chargeType and emits reservation.service_attached', async () => {
      const selectImpls = [
        chainResolving([mockReservation])(),
        chainResolving([mockService])(),
      ];
      let call = 0;
      const db = {
        select: vi.fn().mockImplementation(() => selectImpls[call++] ?? chainResolving([])()),
        insert: vi.fn().mockReturnValue(mutateResolving([mockRs])()),
        update: vi.fn(),
        delete: vi.fn(),
      };
      const svc = await buildService(db);
      const result = await svc.attachToReservation('res-001', {
        propertyId: 'prop-001',
        serviceId: 'svc-001',
      });
      expect(result.status).toBe('confirmed');
      expect(mockWebhookService.emit).toHaveBeenCalledWith(
        'reservation.service_attached',
        'reservation_service',
        mockRs.id,
        expect.any(Object),
        'prop-001',
      );
    });

    it('rejects attaching an inactive service', async () => {
      const selectImpls = [
        chainResolving([mockReservation])(),
        chainResolving([{ ...mockService, isActive: false }])(),
      ];
      let call = 0;
      const db = {
        select: vi.fn().mockImplementation(() => selectImpls[call++] ?? chainResolving([])()),
        insert: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      };
      const svc = await buildService(db);
      await expect(
        svc.attachToReservation('res-001', {
          propertyId: 'prop-001',
          serviceId: 'svc-001',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('createService', () => {
    it('creates a service and emits service.created', async () => {
      const db = {
        select: vi.fn(),
        insert: vi.fn().mockReturnValue(mutateResolving([mockService])()),
        update: vi.fn(),
        delete: vi.fn(),
      };
      const svc = await buildService(db);
      const result = await svc.createService({
        propertyId: 'prop-001',
        code: 'BREAKFAST',
        name: 'Breakfast Buffet',
        chargeType: 'food_beverage',
        price: '25.00',
        currencyCode: 'USD',
        postingRule: 'once',
      });
      expect(result.code).toBe('BREAKFAST');
      expect(mockWebhookService.emit).toHaveBeenCalledWith(
        'service.created',
        'service',
        mockService.id,
        expect.any(Object),
        'prop-001',
      );
    });
  });

  describe('cancelReservationService', () => {
    it('sets status to cancelled', async () => {
      const cancelled = { ...mockRs, status: 'cancelled' };
      const db = {
        select: vi.fn().mockImplementation(chainResolving([mockRs])),
        insert: vi.fn(),
        update: vi.fn().mockReturnValue(mutateResolving([cancelled])()),
        delete: vi.fn(),
      };
      const svc = await buildService(db);
      const result = await svc.cancelReservationService('rs-001', 'prop-001');
      expect(result.status).toBe('cancelled');
      expect(mockWebhookService.emit).toHaveBeenCalledWith(
        'reservation.service_cancelled',
        'reservation_service',
        cancelled.id,
        expect.any(Object),
        'prop-001',
      );
    });
  });
});
