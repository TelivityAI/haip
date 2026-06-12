import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { GroupProfileService } from './group-profile.service';
import { WebhookService } from '../webhook/webhook.service';
import { FolioService } from '../folio/folio.service';
import { DRIZZLE } from '../../database/database.module';

const mockProfile = {
  id: 'grp-001',
  propertyId: 'prop-001',
  name: 'Acme Conf',
  type: 'corporate',
  masterFolioId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function createMockDb(returnData: any[] = [mockProfile]) {
  const selectChain = () => ({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockReturnValue({
          offset: vi.fn().mockReturnValue({ orderBy: vi.fn().mockResolvedValue(returnData) }),
        }),
        orderBy: vi.fn().mockResolvedValue(returnData),
        then: (resolve: any) => resolve(returnData),
      }),
    }),
  });

  const mutateChain = () => ({
    values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue(returnData) }),
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue(returnData) }),
    }),
    where: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue(returnData) }),
  });

  return {
    select: vi.fn().mockImplementation(selectChain),
    insert: vi.fn().mockReturnValue(mutateChain()),
    update: vi.fn().mockReturnValue(mutateChain()),
    delete: vi.fn().mockReturnValue(mutateChain()),
  };
}

const mockWebhookService = { emit: vi.fn() };
const mockFolioService = {
  create: vi.fn().mockResolvedValue({ id: 'folio-001', folioNumber: 'F-1', currencyCode: 'USD' }),
  findById: vi.fn().mockResolvedValue({ id: 'folio-001', folioNumber: 'F-1', currencyCode: 'USD' }),
};

async function buildService(db: any) {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      GroupProfileService,
      { provide: DRIZZLE, useValue: db },
      { provide: WebhookService, useValue: mockWebhookService },
      { provide: FolioService, useValue: mockFolioService },
    ],
  }).compile();
  return module.get<GroupProfileService>(GroupProfileService);
}

describe('GroupProfileService', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('createProfile', () => {
    it('creates a profile and emits group.profile_created', async () => {
      const svc = await buildService(createMockDb());
      const result = await svc.createProfile({ propertyId: 'prop-001', name: 'Acme Conf' });
      expect(result.id).toBe('grp-001');
      expect(mockFolioService.create).not.toHaveBeenCalled();
      expect(mockWebhookService.emit).toHaveBeenCalledWith(
        'group.profile_created',
        'group_profile',
        'grp-001',
        expect.any(Object),
        'prop-001',
      );
    });

    it('creates a master folio when requested', async () => {
      const svc = await buildService(createMockDb());
      await svc.createProfile({
        propertyId: 'prop-001',
        name: 'Acme Conf',
        createMasterFolio: true,
        masterFolioGuestId: 'guest-001',
        masterFolioCurrencyCode: 'USD',
      });
      expect(mockFolioService.create).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'master', guestId: 'guest-001' }),
      );
    });

    it('rejects master-folio creation without a guest/currency', async () => {
      const svc = await buildService(createMockDb());
      await expect(
        svc.createProfile({ propertyId: 'prop-001', name: 'X', createMasterFolio: true }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('findProfileById', () => {
    it('throws NotFound when missing', async () => {
      const svc = await buildService(createMockDb([]));
      await expect(svc.findProfileById('x', 'prop-001')).rejects.toThrow(NotFoundException);
    });
  });

  describe('linkReservation', () => {
    it('links a reservation belonging to the property and emits event', async () => {
      // profile lookup, reservation lookup, update -> all use same returnData
      const db = createMockDb([{ ...mockProfile }]);
      let call = 0;
      db.select = vi.fn().mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            then: (resolve: any) => {
              call++;
              if (call === 1) return resolve([mockProfile]);
              return resolve([{ id: 'res-001', propertyId: 'prop-001' }]);
            },
          }),
        }),
      }));
      db.update = vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: 'res-001', groupProfileId: 'grp-001' }]),
          }),
        }),
      });
      const svc = await buildService(db);
      const result = await svc.linkReservation('grp-001', 'prop-001', 'res-001');
      expect(result.groupProfileId).toBe('grp-001');
      expect(mockWebhookService.emit).toHaveBeenCalledWith(
        'group.reservation_linked',
        'group_profile',
        'grp-001',
        { reservationId: 'res-001' },
        'prop-001',
      );
    });

    it('throws NotFound when reservation is not at the property', async () => {
      const db = createMockDb([{ ...mockProfile }]);
      let call = 0;
      db.select = vi.fn().mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            then: (resolve: any) => {
              call++;
              if (call === 1) return resolve([mockProfile]);
              return resolve([]);
            },
          }),
        }),
      }));
      const svc = await buildService(db);
      await expect(
        svc.linkReservation('grp-001', 'prop-001', 'res-999'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('generateGroupInvoice', () => {
    it('rejects when profile has no master folio', async () => {
      const svc = await buildService(createMockDb([{ ...mockProfile, masterFolioId: null }]));
      await expect(
        svc.generateGroupInvoice('grp-001', 'prop-001'),
      ).rejects.toThrow(BadRequestException);
    });

    it('computes totals from master folio charges', async () => {
      const profileWithFolio = { ...mockProfile, masterFolioId: 'folio-001' };
      const db = createMockDb([profileWithFolio]);
      let call = 0;
      db.select = vi.fn().mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue([
              { id: 'c1', type: 'room', description: 'Room', amount: '100.00', taxAmount: '10.00', serviceDate: new Date() },
              { id: 'c2', type: 'room', description: 'Room', amount: '200.00', taxAmount: '20.00', serviceDate: new Date() },
            ]),
            then: (resolve: any) => {
              call++;
              return resolve([profileWithFolio]);
            },
          }),
        }),
      }));
      const svc = await buildService(db);
      const invoice = await svc.generateGroupInvoice('grp-001', 'prop-001');
      expect(invoice.subtotal).toBe('300.00');
      expect(invoice.taxTotal).toBe('30.00');
      expect(invoice.total).toBe('330.00');
      expect(invoice.invoiceNumber).toMatch(/^G-/);
      expect(invoice.lineItems).toHaveLength(2);
    });
  });
});
