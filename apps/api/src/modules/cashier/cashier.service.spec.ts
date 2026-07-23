import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { CashierService } from './cashier.service';
import { WebhookService } from '../webhook/webhook.service';
import { DRIZZLE } from '../../database/database.module';

const mockDrawer = {
  id: 'drawer-001',
  propertyId: 'prop-001',
  name: 'Front Desk 1',
  startingFloat: '200.00',
  isActive: true,
};

const mockSession = {
  id: 'sess-001',
  propertyId: 'prop-001',
  cashDrawerId: 'drawer-001',
  cashierUserId: 'user-001',
  status: 'open',
  openingFloat: '200.00',
  expectedBalance: null,
  countedBalance: null,
  variance: null,
  openedAt: new Date(),
  closedAt: null,
};

const mockWebhookService = { emit: vi.fn() };

async function buildService(db: any) {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      CashierService,
      { provide: DRIZZLE, useValue: db },
      { provide: WebhookService, useValue: mockWebhookService },
    ],
  }).compile();
  return module.get<CashierService>(CashierService);
}

describe('CashierService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('findSessionById (multi-tenancy)', () => {
    it('throws NotFound when scoped propertyId does not match (db returns [])', async () => {
      const db: any = {
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              then: (resolve: any) => resolve([]),
            }),
          }),
        })),
      };
      const svc = await buildService(db);
      await expect(svc.findSessionById('sess-001', 'other-prop')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('openSession', () => {
    it('opens a session using drawer float and emits cashdrawer.session_opened', async () => {
      let selectCall = 0;
      const db: any = {
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              then: (resolve: any) => {
                selectCall++;
                // 1: findDrawerById, 2: count of open sessions (0)
                if (selectCall === 1) resolve([mockDrawer]);
                else resolve([{ count: 0 }]);
              },
            }),
          }),
        })),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([mockSession]),
          }),
        }),
      };
      const svc = await buildService(db);
      const result = await svc.openSession({
        propertyId: 'prop-001',
        cashDrawerId: 'drawer-001',
        cashierUserId: 'user-001',
      });
      expect(result.status).toBe('open');
      expect(result.openingFloat).toBe('200.00');
      expect(mockWebhookService.emit).toHaveBeenCalledWith(
        'cashdrawer.session_opened',
        'cash_drawer_session',
        mockSession.id,
        expect.any(Object),
        'prop-001',
      );
    });

    it('rejects opening a second session for the same user/drawer (KB 12.5)', async () => {
      let selectCall = 0;
      const db: any = {
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              then: (resolve: any) => {
                selectCall++;
                if (selectCall === 1) resolve([mockDrawer]);
                else resolve([{ count: 1 }]); // already an open session
              },
            }),
          }),
        })),
        insert: vi.fn(),
      };
      const svc = await buildService(db);
      await expect(
        svc.openSession({
          propertyId: 'prop-001',
          cashDrawerId: 'drawer-001',
          cashierUserId: 'user-001',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('recordMovement', () => {
    it('records a movement on an open session and emits cashdrawer.movement_recorded', async () => {
      const movement = { id: 'mv-001', propertyId: 'prop-001', sessionId: 'sess-001', type: 'payment', amount: '50.00' };
      const db: any = {
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              then: (resolve: any) => resolve([mockSession]),
            }),
          }),
        })),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([movement]),
          }),
        }),
      };
      const svc = await buildService(db);
      const result = await svc.recordMovement('sess-001', {
        propertyId: 'prop-001',
        type: 'payment',
        amount: '50.00',
      });
      expect(result.type).toBe('payment');
      expect(mockWebhookService.emit).toHaveBeenCalledWith(
        'cashdrawer.movement_recorded',
        'cash_movement',
        'mv-001',
        expect.any(Object),
        'prop-001',
      );
    });

    it('rejects recording a movement on a closed session', async () => {
      const db: any = {
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              then: (resolve: any) => resolve([{ ...mockSession, status: 'closed' }]),
            }),
          }),
        })),
        insert: vi.fn(),
      };
      const svc = await buildService(db);
      await expect(
        svc.recordMovement('sess-001', { propertyId: 'prop-001', type: 'payment', amount: '50.00' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('closeSession (variance math, KB 12.4)', () => {
    it('computes expected = float + payments - refunds - paid_out - drop, and variance = counted - expected', async () => {
      // movements: payments 300, refunds 20, paid_out 30, drop 100
      // expected = 200 + 300 - 20 - 30 - 100 = 350
      // counted = 360 -> variance = +10 (over)
      const movementRows = [
        { type: 'payment', total: '300' },
        { type: 'refund', total: '20' },
        { type: 'paid_out', total: '30' },
        { type: 'drop', total: '100' },
      ];
      const closedSession = {
        ...mockSession,
        status: 'closed',
        expectedBalance: '350.00',
        countedBalance: '360.00',
        variance: '10.00',
      };
      const db: any = {
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              then: (resolve: any) => resolve([mockSession]), // findSessionById
              groupBy: vi.fn().mockResolvedValue(movementRows), // computeExpectedBalance
            }),
          }),
        })),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockResolvedValue([]),
        }),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([closedSession]),
            }),
          }),
        }),
      };
      db.transaction = (cb: any) => cb(db);
      const svc = await buildService(db);
      const result = await svc.closeSession('sess-001', {
        propertyId: 'prop-001',
        countedBalance: '360.00',
      });
      expect(result.expectedBalance).toBe('350.00');
      expect(result.variance).toBe('10.00');
      expect(mockWebhookService.emit).toHaveBeenCalledWith(
        'cashdrawer.session_closed',
        'cash_drawer_session',
        closedSession.id,
        expect.objectContaining({ variance: '10.00' }),
        'prop-001',
      );
    });

    it('rejects closing an already-closed session', async () => {
      const db: any = {
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              then: (resolve: any) => resolve([{ ...mockSession, status: 'closed' }]),
            }),
          }),
        })),
        insert: vi.fn(),
        update: vi.fn(),
      };
      db.transaction = (cb: any) => cb(db);
      const svc = await buildService(db);
      await expect(
        svc.closeSession('sess-001', { propertyId: 'prop-001', countedBalance: '360.00' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('listDrawers', () => {
    it('returns drawers scoped to propertyId', async () => {
      const db: any = {
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockResolvedValue([mockDrawer]),
            }),
          }),
        })),
      };
      const svc = await buildService(db);
      const result = await svc.listDrawers('prop-001');
      expect(result.data).toHaveLength(1);
      expect(result.data[0].name).toBe('Front Desk 1');
    });
  });

  describe('listSessions', () => {
    it('filters open sessions for a drawer', async () => {
      const db: any = {
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockResolvedValue([mockSession]),
            }),
          }),
        })),
      };
      const svc = await buildService(db);
      const result = await svc.listSessions('prop-001', {
        cashDrawerId: 'drawer-001',
        status: 'open',
      });
      expect(result.total).toBe(1);
      expect(result.data[0].status).toBe('open');
    });
  });
});
