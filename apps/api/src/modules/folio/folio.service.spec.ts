import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { FolioService } from './folio.service';
import { WebhookService } from '../webhook/webhook.service';
import { TaxService } from '../tax/tax.service';
import { DRIZZLE } from '../../database/database.module';
import { charges, folios, payments } from '@telivityhaip/database';

const mockFolio = {
  id: 'folio-001',
  propertyId: 'prop-001',
  reservationId: 'res-001',
  guestId: 'guest-001',
  folioNumber: 'F-260405-0001',
  type: 'guest',
  status: 'open',
  totalCharges: '0.00',
  totalPayments: '0.00',
  balance: '0.00',
  currencyCode: 'USD',
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockCharge = {
  id: 'charge-001',
  propertyId: 'prop-001',
  folioId: 'folio-001',
  type: 'room',
  description: 'Room tariff',
  amount: '150.00',
  currencyCode: 'USD',
  taxAmount: '13.13',
  isReversal: false,
  isLocked: false,
  createdAt: new Date(),
};

function createMockDb(returnData: any[] = [mockFolio]) {
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
const mockTaxService = { calculateTaxes: vi.fn().mockResolvedValue([]) };

function sqlPredicateParts(value: any, parts = {
  columns: [] as string[],
  params: [] as unknown[],
}) {
  if (!value || typeof value !== 'object') return parts;
  if (typeof value.name === 'string') parts.columns.push(value.name);
  if (value.constructor?.name === 'Param') parts.params.push(value.value);
  if (Array.isArray(value.queryChunks)) {
    for (const chunk of value.queryChunks) sqlPredicateParts(chunk, parts);
  }
  return parts;
}

describe('FolioService', () => {
  let service: FolioService;
  let mockDb: ReturnType<typeof createMockDb>;

  beforeEach(async () => {
    mockDb = createMockDb();
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FolioService,
        { provide: DRIZZLE, useValue: mockDb },
        { provide: WebhookService, useValue: mockWebhookService },
        { provide: TaxService, useValue: mockTaxService },
      ],
    }).compile();

    service = module.get<FolioService>(FolioService);
  });

  describe('create', () => {
    it('should create a folio with auto-generated folioNumber', async () => {
      const result = await service.create({
        propertyId: 'prop-001',
        guestId: 'guest-001',
        type: 'guest',
        currencyCode: 'USD',
      });

      expect(result).toEqual(mockFolio);
      expect(mockDb.insert).toHaveBeenCalled();
      expect(mockWebhookService.emit).toHaveBeenCalledWith(
        'folio.created',
        'folio',
        mockFolio.id,
        expect.objectContaining({ folioNumber: mockFolio.folioNumber }),
        mockFolio.propertyId,
      );
    });
  });

  describe('findById', () => {
    it('should return a folio when found', async () => {
      const result = await service.findById('folio-001', 'prop-001');
      expect(result).toEqual(mockFolio);
    });

    it('should throw NotFoundException when not found', async () => {
      const emptyDb = createMockDb([]);
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          FolioService,
          { provide: DRIZZLE, useValue: emptyDb },
          { provide: WebhookService, useValue: mockWebhookService },
          { provide: TaxService, useValue: mockTaxService },
        ],
      }).compile();
      const svc = module.get<FolioService>(FolioService);

      await expect(svc.findById('nonexistent', 'prop-001')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('list', () => {
    it('should return paginated results', async () => {
      const result = await service.list({
        propertyId: 'prop-001',
        page: 1,
        limit: 20,
      });

      expect(result).toEqual({
        data: [mockFolio],
        total: expect.any(Number),
        page: 1,
        limit: 20,
      });
    });
  });

  describe('update', () => {
    it('should update mutable fields on an open folio', async () => {
      const result = await service.update('folio-001', 'prop-001', {
        notes: 'Updated notes',
      });
      expect(result).toEqual(mockFolio);
      expect(mockDb.update).toHaveBeenCalled();
    });
  });

  describe('settle', () => {
    it('should settle folio when balance is zero', async () => {
      // Mock folio with zero balance and no pending payments
      let callCount = 0;
      const settledFolio = { ...mockFolio, status: 'settled', settledAt: new Date() };
      const db = {
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              then: (resolve: any) => {
                callCount++;
                // First call: findById returns open folio with zero balance
                // Second call: count pending payments returns 0
                if (callCount === 1) resolve([mockFolio]);
                else resolve([{ count: 0 }]);
              },
            }),
          }),
        })),
        insert: vi.fn(),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([settledFolio]),
            }),
          }),
        }),
        delete: vi.fn(),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          FolioService,
          { provide: DRIZZLE, useValue: db },
          { provide: WebhookService, useValue: mockWebhookService },
          { provide: TaxService, useValue: mockTaxService },
        ],
      }).compile();
      const svc = module.get<FolioService>(FolioService);

      const result = await svc.settle('folio-001', 'prop-001');
      expect(result.status).toBe('settled');
    });

    it('should throw when balance is non-zero', async () => {
      const nonZeroFolio = { ...mockFolio, balance: '150.00' };
      const db = createMockDb([nonZeroFolio]);
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          FolioService,
          { provide: DRIZZLE, useValue: db },
          { provide: WebhookService, useValue: mockWebhookService },
          { provide: TaxService, useValue: mockTaxService },
        ],
      }).compile();
      const svc = module.get<FolioService>(FolioService);

      await expect(svc.settle('folio-001', 'prop-001')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('transferCharge', () => {
    it('should reject self-transfer', async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          FolioService,
          { provide: DRIZZLE, useValue: { transaction: vi.fn() } },
          { provide: WebhookService, useValue: mockWebhookService },
          { provide: TaxService, useValue: mockTaxService },
        ],
      }).compile();
      const svc = module.get<FolioService>(FolioService);

      await expect(
        svc.transferCharge('folio-001', 'prop-001', {
          chargeId: 'charge-001',
          targetFolioId: 'folio-001',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should transfer charge between folios', async () => {
      let selectCallCount = 0;
      const targetFolio = { ...mockFolio, id: 'folio-002' };
      const thenResolver = (resolve: any) => {
        selectCallCount++;
        // Bug 2: new order is deterministic by folio.id: folio-001 (source), folio-002 (target), charge lookup, then recalc sums.
        if (selectCallCount === 1) resolve([mockFolio]);
        else if (selectCallCount === 2) resolve([targetFolio]);
        else if (selectCallCount === 3) resolve([mockCharge]);
        else resolve([{ total: '0' }]);
      };
      const whereChain = () => ({
        then: thenResolver,
        // .for('update') returns a thenable that also resolves the current row
        for: vi.fn().mockReturnValue({ then: thenResolver }),
      });
      const db: any = {
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockImplementation(whereChain),
          }),
        })),
        insert: vi.fn(),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([]),
            }),
          }),
        }),
        delete: vi.fn(),
      };
      // Bug 2: transferCharge wraps everything in db.transaction — pass tx = db.
      db.transaction = (cb: any) => cb(db);

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          FolioService,
          { provide: DRIZZLE, useValue: db },
          { provide: WebhookService, useValue: mockWebhookService },
          { provide: TaxService, useValue: mockTaxService },
        ],
      }).compile();
      const svc = module.get<FolioService>(FolioService);

      const result = await svc.transferCharge('folio-001', 'prop-001', {
        chargeId: 'charge-001',
        targetFolioId: 'folio-002',
      });
      expect(result).toEqual({ transferred: true });
    });
  });

  describe('postCharge', () => {
    it('should post charge and recalculate balance', async () => {
      let selectCallCount = 0;
      const db = {
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              then: (resolve: any) => {
                selectCallCount++;
                // 1: findById (folio), 2-3: recalculate sums
                if (selectCallCount === 1) resolve([mockFolio]);
                else resolve([{ total: '163.13' }]);
              },
            }),
          }),
        })),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([mockCharge]),
          }),
        }),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([]),
            }),
          }),
        }),
        delete: vi.fn(),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          FolioService,
          { provide: DRIZZLE, useValue: db },
          { provide: WebhookService, useValue: mockWebhookService },
          { provide: TaxService, useValue: mockTaxService },
        ],
      }).compile();
      const svc = module.get<FolioService>(FolioService);

      const result = await svc.postCharge('folio-001', {
        propertyId: 'prop-001',
        type: 'room',
        description: 'Room tariff',
        amount: '150.00',
        currencyCode: 'USD',
        taxAmount: '13.13',
        serviceDate: '2026-04-05',
      });

      expect(result).toEqual(expect.objectContaining({ id: mockCharge.id, type: 'room' }));
      expect(mockWebhookService.emit).toHaveBeenCalledWith(
        'folio.charge_posted',
        'charge',
        mockCharge.id,
        expect.any(Object),
        'prop-001',
      );
    });
  });

  describe('postChargeFromSnapshot', () => {
    it('posts the frozen base, tax, and custom adjustment exactly once after commit', async () => {
      const tx = { marker: 'snapshot-transaction' };
      const db = {
        transaction: vi.fn(async (callback: (transaction: unknown) => Promise<unknown>) =>
          callback(tx)),
      };
      const webhook = { emit: vi.fn().mockResolvedValue(undefined) };
      const tax = { calculateTaxes: vi.fn() };
      const snapshotService = new FolioService(db as any, webhook as any, tax as any);
      const postCharge = vi.spyOn(snapshotService, 'postCharge').mockImplementation(async (
        _folioId: string,
        dto: any,
        _tx?: unknown,
        metadata?: { parentChargeId?: string },
      ) => ({
        id: `charge-${dto.type}`,
        ...dto,
        parentChargeId: metadata?.parentChargeId ?? null,
        taxCharges: [],
      }));

      const result = await snapshotService.postChargeFromSnapshot(
        'folio-001',
        {
          propertyId: 'prop-001',
          type: 'room',
          description: 'Room tariff - 2026-04-04',
          amount: '123.00',
          currencyCode: 'USD',
          serviceDate: '2026-04-04T00:00:00.000Z',
        },
        '12.00',
        { amount: '-15.00', reason: 'Loyalty recovery' },
      );

      expect(db.transaction).toHaveBeenCalledOnce();
      expect(postCharge).toHaveBeenCalledTimes(3);
      expect(postCharge.mock.calls.map((call) => ({
        type: call[1].type,
        amount: call[1].amount,
        transaction: call[2],
      }))).toEqual([
        { type: 'room', amount: '123.00', transaction: tx },
        { type: 'tax', amount: '12.00', transaction: tx },
        { type: 'adjustment', amount: '-15.00', transaction: tx },
      ]);
      expect(tax.calculateTaxes).not.toHaveBeenCalled();
      expect(webhook.emit).toHaveBeenCalledTimes(3);
      expect(result.adjustmentCharges).toHaveLength(1);
      expect(result.taxCharges).toEqual([
        expect.objectContaining({ parentChargeId: result.id }),
      ]);
      expect(result.adjustmentCharges).toEqual([
        expect.objectContaining({ parentChargeId: result.id }),
      ]);
    });

    it('posts one frozen base/tax group under concurrent attempts with the same source key', async () => {
      const ledger: Array<Record<string, any>> = [];
      let sequence = 1;
      let transactionQueue = Promise.resolve();
      const db: any = {
        transaction: vi.fn(async (callback: (tx: any) => Promise<unknown>) => {
          const previous = transactionQueue;
          let release = () => undefined;
          transactionQueue = new Promise<void>((resolve) => {
            release = resolve;
          });
          await previous;
          try {
            return await callback(db);
          } finally {
            release();
          }
        }),
        select: vi.fn((projection?: Record<string, unknown>) => ({
          from: vi.fn((table: unknown) => ({
            where: vi.fn(async (predicate: unknown) => {
              if (table === folios) return [{ ...mockFolio, status: 'open' }];
              if (projection?.['total']) return [{ total: '0' }];
              if (table === payments) return [{ total: '0' }];
              const parts = sqlPredicateParts(predicate);
              if (parts.columns.includes('source_key')) {
                const sourceKey = parts.params.find((param) =>
                  typeof param === 'string' && param.startsWith('accepted-pricing:'));
                return ledger.filter((row) => row.sourceKey === sourceKey);
              }
              if (parts.columns.includes('parent_charge_id')) {
                const parentId = parts.params.find((param) =>
                  typeof param === 'string' && param.startsWith('charge-'));
                return ledger.filter((row) =>
                  row.parentChargeId === parentId && !row.isReversal);
              }
              return [];
            }),
          })),
        })),
        insert: vi.fn((table: unknown) => ({
          values: vi.fn((values: Record<string, unknown>) => {
            const insert = async (conflictSafe: boolean) => {
              if (
                conflictSafe
                && values.sourceKey
                && ledger.some((row) =>
                  row.propertyId === values.propertyId
                  && row.folioId === values.folioId
                  && row.sourceKey === values.sourceKey)
              ) {
                return [];
              }
              const row = { id: `charge-${sequence++}`, ...values };
              if (table === charges) ledger.push(row);
              return [row];
            };
            return {
              returning: vi.fn(() => insert(false)),
              onConflictDoNothing: vi.fn(() => ({
                returning: vi.fn(() => insert(true)),
              })),
            };
          }),
        })),
        update: vi.fn(() => ({
          set: vi.fn(() => ({ where: vi.fn(async () => []) })),
        })),
      };
      const webhook = { emit: vi.fn().mockResolvedValue(undefined) };
      const svc = new FolioService(db, webhook as any, { calculateTaxes: vi.fn() } as any);
      const input = {
        propertyId: 'prop-001',
        type: 'parking',
        description: 'Frozen parking',
        amount: '15.00',
        currencyCode: 'USD',
        serviceDate: '2026-04-04T00:00:00.000Z',
      };
      const sourceKey = 'accepted-pricing:reservation-service:rs-1:once';

      const outcomes = await Promise.all([
        (svc as any).postChargeFromSnapshotWithOutcome(
          'folio-001', input, '2.00', undefined, sourceKey,
        ),
        (svc as any).postChargeFromSnapshotWithOutcome(
          'folio-001', input, '2.00', undefined, sourceKey,
        ),
      ]);

      expect(ledger.map((row) => row.type)).toEqual(['parking', 'tax']);
      expect(outcomes.map((outcome) => outcome.wasCreated).sort()).toEqual([false, true]);
      expect(outcomes[0].charge.id).toBe(outcomes[1].charge.id);
      expect(outcomes[0].charge.taxCharges).toEqual(outcomes[1].charge.taxCharges);
      expect(webhook.emit).toHaveBeenCalledTimes(2);

      const publicReplay = await svc.postChargeFromSnapshot(
        'folio-001', input as any, '2.00', undefined, sourceKey,
      );
      expect(publicReplay).not.toHaveProperty('wasCreated');
      expect(JSON.parse(JSON.stringify(publicReplay))).not.toHaveProperty('wasCreated');
    });
  });

  describe('reverseCharge', () => {
    it('should create a negated charge for reversal', async () => {
      const reversalCharge = {
        ...mockCharge,
        id: 'charge-002',
        amount: '-150.00',
        taxAmount: '-13.13',
        isReversal: true,
        originalChargeId: 'charge-001',
      };
      let selectCallCount = 0;
      const db = {
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              then: (resolve: any) => {
                selectCallCount++;
                // 1: find original charge, 2: check already reversed (none), 3-4: recalculate
                if (selectCallCount === 1) resolve([mockCharge]);
                else if (selectCallCount === 2) resolve([]);
                else resolve([{ total: '0' }]);
              },
            }),
          }),
        })),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([reversalCharge]),
          }),
        }),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([]),
            }),
          }),
        }),
        delete: vi.fn(),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          FolioService,
          { provide: DRIZZLE, useValue: db },
          { provide: WebhookService, useValue: mockWebhookService },
          { provide: TaxService, useValue: mockTaxService },
        ],
      }).compile();
      const svc = module.get<FolioService>(FolioService);

      const result = await svc.reverseCharge('folio-001', 'charge-001', 'prop-001');
      expect(result.isReversal).toBe(true);
      expect(parseFloat(result.amount)).toBeLessThan(0);
    });

    it('should reject reversing a reversal transaction', async () => {
      const reversalCharge = {
        ...mockCharge,
        id: 'charge-002',
        amount: '-150.00',
        isReversal: true,
        originalChargeId: 'charge-001',
      };
      const db = {
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              then: (resolve: any) => resolve([reversalCharge]),
            }),
          }),
        })),
        insert: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          FolioService,
          { provide: DRIZZLE, useValue: db },
          { provide: WebhookService, useValue: mockWebhookService },
          { provide: TaxService, useValue: mockTaxService },
        ],
      }).compile();
      const svc = module.get<FolioService>(FolioService);

      await expect(svc.reverseCharge('folio-001', 'charge-002', 'prop-001')).rejects.toThrow(
        'Cannot reverse a reversal transaction',
      );
      expect(db.insert).not.toHaveBeenCalled();
    });

    it('reverses frozen tax and accepted adjustment children with the base exactly once', async () => {
      const base = {
        ...mockCharge,
        id: 'base-charge',
        taxAmount: '0.00',
        serviceDate: new Date('2026-04-04T00:00:00.000Z'),
      };
      const taxChild = {
        ...base,
        id: 'tax-child',
        type: 'tax',
        amount: '12.00',
        parentChargeId: base.id,
      };
      const adjustmentChild = {
        ...base,
        id: 'adjustment-child',
        type: 'adjustment',
        amount: '-15.00',
        parentChargeId: base.id,
      };
      const inserted: Array<Record<string, any>> = [];
      const chargeLookupPredicates: Array<{ columns: string[]; params: unknown[] }> = [];
      let nextId = 1;
      const db: any = {
        transaction: vi.fn(async (callback: (tx: any) => Promise<unknown>) => callback(db)),
        select: vi.fn((projection?: Record<string, unknown>) => ({
          from: vi.fn((table: unknown) => ({
            where: vi.fn(async (predicate: unknown) => {
              if (projection?.['total']) return [{ total: '0' }];
              if (table === payments) return [{ total: '0' }];
              const parts = sqlPredicateParts(predicate);
              if (table === charges) {
                chargeLookupPredicates.push({
                  columns: [...parts.columns],
                  params: [...parts.params],
                });
              }
              if (parts.columns.includes('parent_charge_id')) {
                const children = [taxChild, adjustmentChild];
                return parts.params.includes('tax')
                  ? children.filter((child) => child.type === 'tax')
                  : children;
              }
              if (parts.columns.includes('original_charge_id')) {
                const originalId = parts.params.find((param) =>
                  ['base-charge', 'tax-child', 'adjustment-child'].includes(String(param)));
                return inserted.filter((row) =>
                  row.originalChargeId === originalId && row.isReversal);
              }
              return [base];
            }),
          })),
        })),
        insert: vi.fn(() => ({
          values: vi.fn((values: Record<string, unknown>) => ({
            returning: vi.fn(async () => {
              const row = { id: `reversal-${nextId++}`, ...values };
              inserted.push(row);
              return [row];
            }),
          })),
        })),
        update: vi.fn((table: unknown) => ({
          set: vi.fn(() => ({
            where: vi.fn(async () => table === folios ? [] : []),
          })),
        })),
      };
      const svc = new FolioService(
        db,
        { emit: vi.fn().mockResolvedValue(undefined) } as any,
        { calculateTaxes: vi.fn() } as any,
      );

      await svc.reverseCharge('folio-001', base.id, 'prop-001');

      expect(db.transaction).toHaveBeenCalledOnce();
      expect(inserted.map((row) => ({
        type: row.type,
        originalChargeId: row.originalChargeId,
        parentChargeId: row.parentChargeId ?? null,
      }))).toEqual([
        { type: 'room', originalChargeId: base.id, parentChargeId: null },
        { type: 'tax', originalChargeId: taxChild.id, parentChargeId: 'reversal-1' },
        {
          type: 'adjustment',
          originalChargeId: adjustmentChild.id,
          parentChargeId: 'reversal-1',
        },
      ]);
      await expect(
        svc.reverseCharge('folio-001', base.id, 'prop-001'),
      ).rejects.toThrow(/already been reversed/i);
      expect(inserted).toHaveLength(3);
      expect(chargeLookupPredicates.length).toBeGreaterThan(0);
      expect(chargeLookupPredicates.every((predicate) =>
        predicate.columns.includes('property_id')
        && predicate.params.includes('prop-001'))).toBe(true);
    });
  });

  describe('close', () => {
    it('should close a settled folio', async () => {
      const settledFolio = { ...mockFolio, status: 'settled' };
      const closedFolio = { ...settledFolio, status: 'closed', closedAt: new Date() };
      let callCount = 0;
      const db = {
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              then: (resolve: any) => {
                callCount++;
                resolve(callCount === 1 ? [settledFolio] : []);
              },
            }),
          }),
        })),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([closedFolio]),
            }),
          }),
        }),
      };
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          FolioService,
          { provide: DRIZZLE, useValue: db },
          { provide: WebhookService, useValue: mockWebhookService },
          { provide: TaxService, useValue: mockTaxService },
        ],
      }).compile();
      const svc = module.get<FolioService>(FolioService);

      const result = await svc.close('folio-001', 'prop-001');
      expect(result.status).toBe('closed');
    });

    it('should throw when folio is not settled', async () => {
      const db = createMockDb([mockFolio]);
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          FolioService,
          { provide: DRIZZLE, useValue: db },
          { provide: WebhookService, useValue: mockWebhookService },
          { provide: TaxService, useValue: mockTaxService },
        ],
      }).compile();
      const svc = module.get<FolioService>(FolioService);

      await expect(svc.close('folio-001', 'prop-001')).rejects.toThrow(BadRequestException);
    });
  });

  describe('getCharges', () => {
    it('should return paginated charges with filters', async () => {
      let selectCall = 0;
      const db = {
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                offset: vi.fn().mockReturnValue({
                  orderBy: vi.fn().mockResolvedValue([mockCharge]),
                }),
              }),
              then: (resolve: any) => {
                selectCall++;
                resolve([{ count: 1 }]);
              },
            }),
          }),
        })),
      };
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          FolioService,
          { provide: DRIZZLE, useValue: db },
          { provide: WebhookService, useValue: mockWebhookService },
          { provide: TaxService, useValue: mockTaxService },
        ],
      }).compile();
      const svc = module.get<FolioService>(FolioService);

      const result = await svc.getCharges('folio-001', {
        propertyId: 'prop-001',
        type: 'room',
        page: 1,
        limit: 10,
      });
      expect(result.data).toEqual([mockCharge]);
      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
    });
  });

  describe('lockCharges', () => {
    it('should lock charges up to audit date', async () => {
      const locked = [{ ...mockCharge, isLocked: true }];
      const db = {
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue(locked),
            }),
          }),
        }),
      };
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          FolioService,
          { provide: DRIZZLE, useValue: db },
          { provide: WebhookService, useValue: mockWebhookService },
          { provide: TaxService, useValue: mockTaxService },
        ],
      }).compile();
      const svc = module.get<FolioService>(FolioService);

      const result = await svc.lockCharges('folio-001', 'prop-001', new Date('2026-04-05'));
      expect(result.lockedCount).toBe(1);
    });
  });

  describe('postRoomTariff', () => {
    it('should post a room tariff charge', async () => {
      let selectCallCount = 0;
      const db = {
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              then: (resolve: any) => {
                selectCallCount++;
                if (selectCallCount === 1) resolve([mockFolio]);
                else resolve([{ total: '150.00' }]);
              },
            }),
          }),
        })),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([mockCharge]),
          }),
        }),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([]),
          }),
        }),
      };
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          FolioService,
          { provide: DRIZZLE, useValue: db },
          { provide: WebhookService, useValue: mockWebhookService },
          { provide: TaxService, useValue: mockTaxService },
        ],
      }).compile();
      const svc = module.get<FolioService>(FolioService);

      const result = await svc.postRoomTariff(
        'folio-001',
        'prop-001',
        '150.00',
        'USD',
        new Date('2026-04-05'),
      );
      expect(result.type).toBe('room');
    });
  });

  describe('createAutoFolio', () => {
    it('should create a guest folio for a reservation', async () => {
      const result = await service.createAutoFolio({
        id: 'res-001',
        propertyId: 'prop-001',
        guestId: 'guest-001',
        currencyCode: 'USD',
      });
      expect(result).toEqual(mockFolio);
      expect(mockWebhookService.emit).toHaveBeenCalled();
    });
  });

  describe('settle — pending payments guard', () => {
    it('should throw when pending authorized payments exist', async () => {
      let callCount = 0;
      const db = {
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              then: (resolve: any) => {
                callCount++;
                if (callCount === 1) resolve([mockFolio]);
                else resolve([{ count: 2 }]);
              },
            }),
          }),
        })),
      };
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          FolioService,
          { provide: DRIZZLE, useValue: db },
          { provide: WebhookService, useValue: mockWebhookService },
          { provide: TaxService, useValue: mockTaxService },
        ],
      }).compile();
      const svc = module.get<FolioService>(FolioService);

      await expect(svc.settle('folio-001', 'prop-001')).rejects.toThrow(BadRequestException);
    });
  });

  describe('recalculateBalance', () => {
    it('nets a captured parent with a negative refund child', async () => {
      let selectCall = 0;
      const db = {
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              then: (resolve: any) => {
                selectCall++;
                if (selectCall === 1) resolve([{ total: '100.00' }]);
                else resolve([{ total: '50.00' }]);
              },
            }),
          }),
        })),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([]),
          }),
        }),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          FolioService,
          { provide: DRIZZLE, useValue: db },
          { provide: WebhookService, useValue: mockWebhookService },
          { provide: TaxService, useValue: mockTaxService },
        ],
      }).compile();
      const svc = module.get<FolioService>(FolioService);

      await svc.recalculateBalance('folio-001', 'prop-001');

      const setCall = db.update.mock.results[0].value.set.mock.calls[0][0];
      expect(setCall.totalPayments).toBe('50.00');
      expect(setCall.balance).toBe('50.00');
    });
  });
});
