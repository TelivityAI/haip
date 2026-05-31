import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { ArService } from './ar.service';
import { WebhookService } from '../webhook/webhook.service';
import { FolioService } from '../folio/folio.service';
import { DRIZZLE } from '../../database/database.module';

const mockLedger = {
  id: 'arl-001',
  propertyId: 'prop-001',
  name: 'Acme Corp',
  description: null,
  paymentTermsDays: 'NET30',
  status: 'open',
  balance: '0.00',
  currencyCode: 'USD',
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockFolio = {
  id: 'folio-001',
  propertyId: 'prop-001',
  type: 'guest',
  status: 'open',
  balance: '150.00',
  currencyCode: 'USD',
};

const mockWebhookService = { emit: vi.fn() };

async function buildService(db: any, folioService: any) {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      ArService,
      { provide: DRIZZLE, useValue: db },
      { provide: WebhookService, useValue: mockWebhookService },
      { provide: FolioService, useValue: folioService },
    ],
  }).compile();
  return module.get<ArService>(ArService);
}

function thenableSelect(resolver: () => any[]) {
  return {
    select: vi.fn().mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          then: (resolve: any) => resolve(resolver()),
          limit: vi.fn().mockReturnValue({
            offset: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockResolvedValue(resolver()),
            }),
          }),
        }),
      }),
    })),
  };
}

describe('ArService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createLedger', () => {
    it('creates an open ledger with zero balance and emits ar.ledger_created', async () => {
      const db: any = {
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([mockLedger]),
          }),
        }),
      };
      const svc = await buildService(db, {});
      const result = await svc.createLedger({
        propertyId: 'prop-001',
        name: 'Acme Corp',
        currencyCode: 'USD',
      });
      expect(result.status).toBe('open');
      expect(mockWebhookService.emit).toHaveBeenCalledWith(
        'ar.ledger_created',
        'ar_ledger',
        mockLedger.id,
        expect.any(Object),
        'prop-001',
      );
    });
  });

  describe('findLedgerById (multi-tenancy)', () => {
    it('throws NotFound when scoped propertyId does not match (db returns [])', async () => {
      const db: any = thenableSelect(() => []);
      const svc = await buildService(db, {});
      await expect(svc.findLedgerById('arl-001', 'other-prop')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('transferFolioToAR', () => {
    it('zeroes the folio, records transfer_in, bumps ledger balance, emits ar.transfer_created', async () => {
      const insertedTxn = {
        id: 'tx-001',
        propertyId: 'prop-001',
        arLedgerId: 'arl-001',
        type: 'transfer_in',
        amount: '150.00',
        currencyCode: 'USD',
        sourceFolioId: 'folio-001',
      };
      const updateSpy = vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      });
      const db: any = {
        // findLedgerById uses tx.select
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              then: (resolve: any) => resolve([mockLedger]),
            }),
          }),
        })),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([insertedTxn]),
          }),
        }),
        update: updateSpy,
      };
      db.transaction = (cb: any) => cb(db);

      const folioService = {
        findById: vi.fn().mockResolvedValue(mockFolio),
        postCharge: vi.fn().mockResolvedValue({}),
      };

      const svc = await buildService(db, folioService);
      const result = await svc.transferFolioToAR({
        propertyId: 'prop-001',
        folioId: 'folio-001',
        arLedgerId: 'arl-001',
      });

      // Folio zeroed via offsetting negative adjustment
      expect(folioService.postCharge).toHaveBeenCalledWith(
        'folio-001',
        expect.objectContaining({ type: 'adjustment', amount: '-150.00', skipTaxCalculation: true }),
        db,
      );
      // transfer_in txn recorded for the folio balance
      expect(result.type).toBe('transfer_in');
      expect(result.amount).toBe('150.00');
      // ledger balance bumped (0 + 150)
      expect(updateSpy).toHaveBeenCalled();
      const setArg = updateSpy.mock.results[0].value.set.mock.calls[0][0];
      expect(setArg.balance).toBe('150.00');
      expect(mockWebhookService.emit).toHaveBeenCalledWith(
        'ar.transfer_created',
        'ar_transaction',
        'tx-001',
        expect.any(Object),
        'prop-001',
      );
    });

    it('rejects a transfer when the folio balance is zero', async () => {
      const db: any = {
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              then: (resolve: any) => resolve([mockLedger]),
            }),
          }),
        })),
        insert: vi.fn(),
        update: vi.fn(),
      };
      db.transaction = (cb: any) => cb(db);
      const folioService = {
        findById: vi.fn().mockResolvedValue({ ...mockFolio, balance: '0.00' }),
        postCharge: vi.fn(),
      };
      const svc = await buildService(db, folioService);
      await expect(
        svc.transferFolioToAR({ propertyId: 'prop-001', folioId: 'folio-001', arLedgerId: 'arl-001' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('reverseTransfer', () => {
    it('restores the folio, records reverse_transfer, links reversedById, decrements ledger', async () => {
      const original = {
        id: 'tx-001',
        propertyId: 'prop-001',
        arLedgerId: 'arl-001',
        type: 'transfer_in',
        amount: '150.00',
        currencyCode: 'USD',
        sourceFolioId: 'folio-001',
        reversedById: null,
      };
      const ledgerWithBalance = { ...mockLedger, balance: '150.00' };
      const reversal = {
        id: 'tx-002',
        type: 'reverse_transfer',
        amount: '-150.00',
        arLedgerId: 'arl-001',
      };

      let selectCall = 0;
      const updateSpy = vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      });
      const db: any = {
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              then: (resolve: any) => {
                selectCall++;
                // 1: load original txn, 2: findLedgerById
                if (selectCall === 1) resolve([original]);
                else resolve([ledgerWithBalance]);
              },
            }),
          }),
        })),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([reversal]),
          }),
        }),
        update: updateSpy,
      };
      db.transaction = (cb: any) => cb(db);

      const folioService = { findById: vi.fn(), postCharge: vi.fn().mockResolvedValue({}) };
      const svc = await buildService(db, folioService);
      const result = await svc.reverseTransfer('tx-001', 'prop-001');

      // Folio restored via positive adjustment
      expect(folioService.postCharge).toHaveBeenCalledWith(
        'folio-001',
        expect.objectContaining({ type: 'adjustment', amount: '150.00', skipTaxCalculation: true }),
        db,
      );
      expect(result.type).toBe('reverse_transfer');
      // ledger decremented to 0 (150 - 150); inspect every .set() call across
      // both updates (reversedById link + ledger balance) for the balance set.
      const allSetArgs = updateSpy.mock.results.flatMap((r: any) =>
        r.value.set.mock.calls.map((c: any[]) => c[0]),
      );
      const balanceUpdate = allSetArgs.find((s: any) => s.balance !== undefined);
      expect(balanceUpdate.balance).toBe('0.00');
      expect(mockWebhookService.emit).toHaveBeenCalledWith(
        'ar.transfer_reversed',
        'ar_transaction',
        'tx-002',
        expect.any(Object),
        'prop-001',
      );
    });

    it('rejects reversing an already-reversed transfer', async () => {
      const original = {
        id: 'tx-001',
        propertyId: 'prop-001',
        arLedgerId: 'arl-001',
        type: 'transfer_in',
        amount: '150.00',
        currencyCode: 'USD',
        sourceFolioId: 'folio-001',
        reversedById: 'tx-002',
      };
      const db: any = {
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              then: (resolve: any) => resolve([original]),
            }),
          }),
        })),
        insert: vi.fn(),
        update: vi.fn(),
      };
      db.transaction = (cb: any) => cb(db);
      const svc = await buildService(db, { findById: vi.fn(), postCharge: vi.fn() });
      await expect(svc.reverseTransfer('tx-001', 'prop-001')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('recordARPayment', () => {
    it('records a payment txn and decrements ledger balance, emits ar.payment_recorded', async () => {
      const ledgerWithBalance = { ...mockLedger, balance: '150.00' };
      const paymentTxn = { id: 'tx-003', type: 'payment', amount: '50.00', arLedgerId: 'arl-001' };
      const updateSpy = vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      });
      const db: any = {
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              then: (resolve: any) => resolve([ledgerWithBalance]),
            }),
          }),
        })),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([paymentTxn]),
          }),
        }),
        update: updateSpy,
      };
      db.transaction = (cb: any) => cb(db);
      const svc = await buildService(db, {});
      const result = await svc.recordARPayment('arl-001', {
        propertyId: 'prop-001',
        amount: '50.00',
        currencyCode: 'USD',
      });
      expect(result.type).toBe('payment');
      const setArg = updateSpy.mock.results[0].value.set.mock.calls[0][0];
      expect(setArg.balance).toBe('100.00'); // 150 - 50
      expect(mockWebhookService.emit).toHaveBeenCalledWith(
        'ar.payment_recorded',
        'ar_transaction',
        'tx-003',
        expect.any(Object),
        'prop-001',
      );
    });
  });

  describe('aging', () => {
    it('buckets open transfer_in amounts by age', async () => {
      const now = Date.now();
      const day = 1000 * 60 * 60 * 24;
      const rows = [
        { amount: '100.00', createdAt: new Date(now - 5 * day), reversedById: null },
        { amount: '200.00', createdAt: new Date(now - 45 * day), reversedById: null },
        { amount: '300.00', createdAt: new Date(now - 75 * day), reversedById: null },
        { amount: '400.00', createdAt: new Date(now - 120 * day), reversedById: null },
      ];
      const db: any = {
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              then: (resolve: any) => resolve(rows),
            }),
          }),
        })),
      };
      const svc = await buildService(db, {});
      const result = await svc.aging('prop-001', 'arl-001');
      expect(result.buckets.current).toBe('100.00');
      expect(result.buckets.days31to60).toBe('200.00');
      expect(result.buckets.days61to90).toBe('300.00');
      expect(result.buckets.days90plus).toBe('400.00');
      expect(result.total).toBe('1000.00');
    });
  });
});
