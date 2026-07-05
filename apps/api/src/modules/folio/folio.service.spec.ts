import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { FolioService } from './folio.service';
import { WebhookService } from '../webhook/webhook.service';
import { TaxService } from '../tax/tax.service';
import { DRIZZLE } from '../../database/database.module';

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
