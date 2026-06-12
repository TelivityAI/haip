import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { DepositService } from './deposit.service';
import { WebhookService } from '../webhook/webhook.service';
import { FolioService } from '../folio/folio.service';
import { DRIZZLE } from '../../database/database.module';

const mockDeposit = {
  id: 'dep-001',
  propertyId: 'prop-001',
  reservationId: 'res-001',
  paymentId: 'pay-001',
  amount: '200.00',
  currencyCode: 'USD',
  status: 'held',
  isRefundable: true,
  receivedAt: new Date(),
  recognizedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function createMockDb(returnData: any[] = [mockDeposit]) {
  const selectChain = () => ({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockReturnValue({
          offset: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue(returnData),
          }),
        }),
        then: (resolve: any) => resolve(returnData),
      }),
    }),
  });

  const mutateChain = () => ({
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

  return {
    select: vi.fn().mockImplementation(selectChain),
    insert: vi.fn().mockReturnValue(mutateChain()),
    update: vi.fn().mockReturnValue(mutateChain()),
    delete: vi.fn().mockReturnValue(mutateChain()),
  };
}

const mockWebhookService = { emit: vi.fn() };
const mockFolioService = { postCharge: vi.fn().mockResolvedValue({}) };

async function buildService(db: any) {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      DepositService,
      { provide: DRIZZLE, useValue: db },
      { provide: WebhookService, useValue: mockWebhookService },
      { provide: FolioService, useValue: mockFolioService },
    ],
  }).compile();
  return module.get<DepositService>(DepositService);
}

describe('DepositService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('recordDeposit', () => {
    it('creates a held deposit and emits deposit.received', async () => {
      const svc = await buildService(createMockDb());
      const result = await svc.recordDeposit({
        propertyId: 'prop-001',
        amount: '200.00',
        currencyCode: 'USD',
      });
      expect(result.status).toBe('held');
      expect(mockWebhookService.emit).toHaveBeenCalledWith(
        'deposit.received',
        'deposit',
        mockDeposit.id,
        expect.any(Object),
        'prop-001',
      );
    });
  });

  describe('findById (multi-tenancy)', () => {
    it('throws NotFound when scoped propertyId does not match (db returns [])', async () => {
      const svc = await buildService(createMockDb([]));
      await expect(svc.findById('dep-001', 'other-prop')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('applyDeposit', () => {
    it('applies a held deposit, sets recognizedAt, offsets folio, emits deposit.applied', async () => {
      const applied = { ...mockDeposit, status: 'applied', recognizedAt: new Date() };
      const db: any = {
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              then: (resolve: any) => resolve([mockDeposit]), // findById -> held
            }),
          }),
        })),
        insert: vi.fn(),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([applied]),
            }),
          }),
        }),
        delete: vi.fn(),
      };
      const svc = await buildService(db);
      const result = await svc.applyDeposit('dep-001', { propertyId: 'prop-001', folioId: 'folio-001' });
      expect(result.status).toBe('applied');
      expect(mockFolioService.postCharge).toHaveBeenCalledWith(
        'folio-001',
        expect.objectContaining({ type: 'adjustment', amount: '-200.00', skipTaxCalculation: true }),
      );
      expect(mockWebhookService.emit).toHaveBeenCalledWith(
        'deposit.applied',
        'deposit',
        applied.id,
        expect.any(Object),
        'prop-001',
      );
    });

    it('rejects applying a non-held deposit', async () => {
      const svc = await buildService(createMockDb([{ ...mockDeposit, status: 'applied' }]));
      await expect(
        svc.applyDeposit('dep-001', { propertyId: 'prop-001' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('refundDeposit', () => {
    it('refunds a held refundable deposit', async () => {
      const refunded = { ...mockDeposit, status: 'refunded' };
      const db: any = {
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              then: (resolve: any) => resolve([mockDeposit]),
            }),
          }),
        })),
        insert: vi.fn(),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([refunded]),
            }),
          }),
        }),
        delete: vi.fn(),
      };
      const svc = await buildService(db);
      const result = await svc.refundDeposit('dep-001', 'prop-001');
      expect(result.status).toBe('refunded');
    });

    it('rejects refunding a non-refundable deposit', async () => {
      const svc = await buildService(createMockDb([{ ...mockDeposit, isRefundable: false }]));
      await expect(svc.refundDeposit('dep-001', 'prop-001')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects refunding an already-applied deposit', async () => {
      const svc = await buildService(createMockDb([{ ...mockDeposit, status: 'applied' }]));
      await expect(svc.refundDeposit('dep-001', 'prop-001')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('forfeitDeposit', () => {
    it('forfeits a held deposit, recognizing it, and emits deposit.forfeited', async () => {
      const forfeited = { ...mockDeposit, status: 'forfeited', recognizedAt: new Date() };
      const db: any = {
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              then: (resolve: any) => resolve([mockDeposit]),
            }),
          }),
        })),
        insert: vi.fn(),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([forfeited]),
            }),
          }),
        }),
        delete: vi.fn(),
      };
      const svc = await buildService(db);
      const result = await svc.forfeitDeposit('dep-001', 'prop-001');
      expect(result.status).toBe('forfeited');
      expect(result.recognizedAt).not.toBeNull();
      expect(mockWebhookService.emit).toHaveBeenCalledWith(
        'deposit.forfeited',
        'deposit',
        forfeited.id,
        expect.any(Object),
        'prop-001',
      );
    });
  });
});
