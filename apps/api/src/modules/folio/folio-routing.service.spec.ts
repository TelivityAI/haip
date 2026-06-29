import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { FolioRoutingService } from './folio-routing.service';
import { FolioService } from './folio.service';
import { WebhookService } from '../webhook/webhook.service';
import { DRIZZLE } from '../../database/database.module';

const mockWebhookService = { emit: vi.fn() };

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
  balance: '300.00',
  currencyCode: 'USD',
};

const mockReservation = {
  id: 'res-001',
  propertyId: 'prop-001',
  preferences: {
    routing: {
      room: 'folio-company',
      tax: 'folio-company',
      food_beverage: 'folio-001',
      default: 'folio-001',
    },
  },
};

const mockCharge = {
  id: 'charge-001',
  folioId: 'folio-001',
  type: 'room',
  amount: '150.00',
};

const mockFolioService = {
  findById: vi.fn().mockResolvedValue(mockFolio),
  create: vi.fn().mockResolvedValue({ ...mockFolio, id: 'folio-cl-001', type: 'city_ledger' }),
  postCharge: vi.fn().mockResolvedValue(mockCharge),
  recalculateBalance: vi.fn(),
};

function createMockDb(returnData: any[] = [mockReservation]) {
  const whereResult = {
    orderBy: vi.fn().mockResolvedValue([]),
    for: vi.fn().mockResolvedValue(returnData),
    then: (resolve: any) => resolve(returnData),
  };
  const db: any = {
    select: vi.fn().mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue(whereResult),
      }),
    })),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([]),
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
  db.transaction = (cb: any) => cb(db);
  return db;
}

describe('FolioRoutingService', () => {
  let service: FolioRoutingService;
  let mockDb: ReturnType<typeof createMockDb>;

  beforeEach(async () => {
    mockDb = createMockDb();
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FolioRoutingService,
        { provide: DRIZZLE, useValue: mockDb },
        { provide: FolioService, useValue: mockFolioService },
        { provide: WebhookService, useValue: mockWebhookService },
      ],
    }).compile();

    service = module.get<FolioRoutingService>(FolioRoutingService);
  });

  describe('routeCharge', () => {
    it('should route charge to correct folio per routing rules', async () => {
      const chargeDto = {
        propertyId: 'prop-001',
        type: 'room',
        description: 'Room tariff',
        amount: '150.00',
        currencyCode: 'USD',
        serviceDate: '2026-04-05',
      };

      await service.routeCharge('res-001', 'prop-001', 'room', chargeDto);

      // Room charges should go to 'folio-company' per routing rules
      expect(mockFolioService.postCharge).toHaveBeenCalledWith(
        'folio-company',
        chargeDto,
      );
    });

    it('should use default folio when no routing rule matches', async () => {
      const noRoutingReservation = {
        ...mockReservation,
        preferences: {},
      };
      const db = {
        ...createMockDb([noRoutingReservation]),
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              // First call: reservation, second call: findDefaultFolio
              then: (resolve: any) => resolve([noRoutingReservation]),
            }),
          }),
        })),
      };
      // Select call order in resolveTargetFolio: (1) routing rules .orderBy -> [],
      // (2) reservation .then, (3) findDefaultFolio .then.
      let thenCall = 0;
      db.select = vi.fn().mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue([]),
            then: (resolve: any) => {
              thenCall++;
              if (thenCall === 1) resolve([noRoutingReservation]);
              else resolve([mockFolio]);
            },
          }),
        }),
      }));

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          FolioRoutingService,
          { provide: DRIZZLE, useValue: db },
          { provide: FolioService, useValue: mockFolioService },
          { provide: WebhookService, useValue: mockWebhookService },
        ],
      }).compile();
      const svc = module.get<FolioRoutingService>(FolioRoutingService);

      const chargeDto = {
        propertyId: 'prop-001',
        type: 'minibar',
        description: 'Minibar',
        amount: '25.00',
        currencyCode: 'USD',
        serviceDate: '2026-04-05',
      };

      await svc.routeCharge('res-001', 'prop-001', 'minibar', chargeDto);

      expect(mockFolioService.postCharge).toHaveBeenCalledWith(
        mockFolio.id,
        chargeDto,
      );
    });
  });

  describe('findDefaultFolio', () => {
    it('should return the primary guest folio for a reservation', async () => {
      const folioDb = createMockDb([mockFolio]);
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          FolioRoutingService,
          { provide: DRIZZLE, useValue: folioDb },
          { provide: FolioService, useValue: mockFolioService },
          { provide: WebhookService, useValue: mockWebhookService },
        ],
      }).compile();
      const svc = module.get<FolioRoutingService>(FolioRoutingService);

      const result = await svc.findDefaultFolio('res-001', 'prop-001');
      expect(result.type).toBe('guest');
      expect(result.reservationId).toBe('res-001');
    });

    it('should throw NotFoundException when no guest folio exists', async () => {
      const emptyDb = createMockDb([]);
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          FolioRoutingService,
          { provide: DRIZZLE, useValue: emptyDb },
          { provide: FolioService, useValue: mockFolioService },
          { provide: WebhookService, useValue: mockWebhookService },
        ],
      }).compile();
      const svc = module.get<FolioRoutingService>(FolioRoutingService);

      await expect(svc.findDefaultFolio('res-001', 'prop-001')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('resolveTargetFolio (split-folio rules, KB 14.2)', () => {
    it('returns the highest-priority routing rule target', async () => {
      const db: any = {
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockResolvedValue([
                { id: 'rule-1', targetFolioId: 'folio-company', priority: 10 },
              ]),
              then: (resolve: any) => resolve([]),
            }),
          }),
        })),
        insert: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      };
      db.transaction = (cb: any) => cb(db);
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          FolioRoutingService,
          { provide: DRIZZLE, useValue: db },
          { provide: FolioService, useValue: mockFolioService },
          { provide: WebhookService, useValue: mockWebhookService },
        ],
      }).compile();
      const svc = module.get<FolioRoutingService>(FolioRoutingService);

      const target = await svc.resolveTargetFolio('res-001', 'prop-001', 'room');
      expect(target).toBe('folio-company');
    });
  });

  describe('createRoutingRule', () => {
    it('creates a rule and emits folio.routing_rule_created', async () => {
      const rule = {
        id: 'rule-1',
        propertyId: 'prop-001',
        reservationId: 'res-001',
        chargeType: 'room',
        targetFolioId: 'folio-company',
        priority: 5,
      };
      const db: any = {
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              then: (resolve: any) => resolve([mockReservation]),
            }),
          }),
        })),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([rule]),
          }),
        }),
        update: vi.fn(),
        delete: vi.fn(),
      };
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          FolioRoutingService,
          { provide: DRIZZLE, useValue: db },
          { provide: FolioService, useValue: mockFolioService },
          { provide: WebhookService, useValue: mockWebhookService },
        ],
      }).compile();
      const svc = module.get<FolioRoutingService>(FolioRoutingService);

      const result = await svc.createRoutingRule('prop-001', {
        propertyId: 'prop-001',
        reservationId: 'res-001',
        chargeType: 'room',
        targetFolioId: 'folio-company',
        priority: 5,
      });
      expect(result.id).toBe('rule-1');
      expect(mockWebhookService.emit).toHaveBeenCalledWith(
        'folio.routing_rule_created',
        'folio_routing_rule',
        'rule-1',
        expect.any(Object),
        'prop-001',
      );
    });
  });

  describe('moveTransactions (KB 14.2)', () => {
    function moveDb(matchingCharges: any[]) {
      let call = 0;
      const db: any = {
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              // calls in order: lock firstFolio, lock secondFolio, matching charges
              for: vi.fn().mockImplementation(() => {
                const idx = call++;
                return Promise.resolve([
                  { ...mockFolio, id: idx === 0 ? 'folio-001' : 'folio-002', status: 'open' },
                ]);
              }),
              then: (resolve: any) => resolve(matchingCharges),
            }),
          }),
        })),
        insert: vi.fn(),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([]),
          }),
        }),
        delete: vi.fn(),
      };
      db.transaction = (cb: any) => cb(db);
      return db;
    }

    it('moves matching charges and emits folio.transactions_moved', async () => {
      const db = moveDb([
        { id: 'charge-001', type: 'room', isLocked: false },
        { id: 'charge-002', type: 'room', isLocked: false },
      ]);
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          FolioRoutingService,
          { provide: DRIZZLE, useValue: db },
          { provide: FolioService, useValue: mockFolioService },
          { provide: WebhookService, useValue: mockWebhookService },
        ],
      }).compile();
      const svc = module.get<FolioRoutingService>(FolioRoutingService);

      const result = await svc.moveTransactions('prop-001', 'folio-001', 'folio-002', {
        chargeType: 'room',
      });
      expect(result.moved).toBe(2);
      expect(mockFolioService.recalculateBalance).toHaveBeenCalledTimes(2);
      expect(mockWebhookService.emit).toHaveBeenCalledWith(
        'folio.transactions_moved',
        'folio',
        'folio-002',
        expect.objectContaining({ moved: 2 }),
        'prop-001',
      );
    });

    it('rejects moving locked (night-audited) charges', async () => {
      const db = moveDb([{ id: 'charge-001', type: 'room', isLocked: true }]);
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          FolioRoutingService,
          { provide: DRIZZLE, useValue: db },
          { provide: FolioService, useValue: mockFolioService },
          { provide: WebhookService, useValue: mockWebhookService },
        ],
      }).compile();
      const svc = module.get<FolioRoutingService>(FolioRoutingService);

      await expect(
        svc.moveTransactions('prop-001', 'folio-001', 'folio-002', { chargeType: 'room' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('transferToCityLedger', () => {
    it('should create city ledger folio and record payment on source', async () => {
      mockDb = createMockDb([mockFolio]);
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          FolioRoutingService,
          { provide: DRIZZLE, useValue: mockDb },
          { provide: FolioService, useValue: mockFolioService },
          { provide: WebhookService, useValue: mockWebhookService },
        ],
      }).compile();
      const svc = module.get<FolioRoutingService>(FolioRoutingService);

      const result = await svc.transferToCityLedger('folio-001', 'prop-001', {
        companyName: 'Acme Corp',
        paymentTermsDays: 'NET30',
      });

      expect(mockFolioService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'city_ledger',
          companyName: 'Acme Corp',
          paymentTermsDays: 'NET30',
        }),
        expect.anything(),
      );
      expect(mockFolioService.recalculateBalance).toHaveBeenCalled();
      expect(result.transferredAmount).toBe('300.00');
      expect(result.cityLedgerFolioId).toBe('folio-cl-001');
    });
  });
});
