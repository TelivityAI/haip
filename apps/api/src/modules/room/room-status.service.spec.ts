import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { RoomStatusService } from './room-status.service';
import { WebhookService } from '../webhook/webhook.service';
import { DRIZZLE } from '../../database/database.module';

const mockRoom = {
  id: 'room-001',
  propertyId: 'prop-001',
  number: '101',
  status: 'vacant_clean',
  isActive: true,
  maintenanceNotes: null,
};

function createMockDb(returnData: any[] = [mockRoom]) {
  return {
    select: vi.fn().mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          then: (resolve: any) => resolve(returnData),
          groupBy: vi.fn().mockResolvedValue(returnData),
        }),
      }),
    })),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue(returnData.map(r => ({ ...r }))),
        }),
      }),
    }),
  };
}

const mockWebhookService = { emit: vi.fn() };

describe('RoomStatusService', () => {
  let service: RoomStatusService;
  let mockDb: ReturnType<typeof createMockDb>;

  beforeEach(async () => {
    mockDb = createMockDb();
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RoomStatusService,
        { provide: DRIZZLE, useValue: mockDb },
        { provide: WebhookService, useValue: mockWebhookService },
      ],
    }).compile();

    service = module.get<RoomStatusService>(RoomStatusService);
  });

  describe('valid transitions', () => {
    it('should transition vacant_clean → occupied', async () => {
      const room = { ...mockRoom, status: 'vacant_clean' };
      const db = createMockDb([room]);
      db.update = vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ ...room, status: 'occupied' }]),
          }),
        }),
      });
      const module = await Test.createTestingModule({
        providers: [
          RoomStatusService,
          { provide: DRIZZLE, useValue: db },
          { provide: WebhookService, useValue: mockWebhookService },
        ],
      }).compile();
      const svc = module.get<RoomStatusService>(RoomStatusService);

      const result = await svc.transitionStatus('room-001', 'prop-001', 'occupied');
      expect(result.status).toBe('occupied');
    });

    it('should transition occupied → vacant_dirty', async () => {
      const room = { ...mockRoom, status: 'occupied' };
      const db = createMockDb([room]);
      db.update = vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ ...room, status: 'vacant_dirty' }]),
          }),
        }),
      });
      const module = await Test.createTestingModule({
        providers: [
          RoomStatusService,
          { provide: DRIZZLE, useValue: db },
          { provide: WebhookService, useValue: mockWebhookService },
        ],
      }).compile();
      const svc = module.get<RoomStatusService>(RoomStatusService);

      const result = await svc.transitionStatus('room-001', 'prop-001', 'vacant_dirty');
      expect(result.status).toBe('vacant_dirty');
    });

    it('should transition vacant_dirty → clean', async () => {
      const room = { ...mockRoom, status: 'vacant_dirty' };
      const db = createMockDb([room]);
      db.update = vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ ...room, status: 'clean' }]),
          }),
        }),
      });
      const module = await Test.createTestingModule({
        providers: [
          RoomStatusService,
          { provide: DRIZZLE, useValue: db },
          { provide: WebhookService, useValue: mockWebhookService },
        ],
      }).compile();
      const svc = module.get<RoomStatusService>(RoomStatusService);

      const result = await svc.transitionStatus('room-001', 'prop-001', 'clean');
      expect(result.status).toBe('clean');
    });

    it('should transition clean → inspected', async () => {
      const room = { ...mockRoom, status: 'clean' };
      const db = createMockDb([room]);
      db.update = vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ ...room, status: 'inspected' }]),
          }),
        }),
      });
      const module = await Test.createTestingModule({
        providers: [
          RoomStatusService,
          { provide: DRIZZLE, useValue: db },
          { provide: WebhookService, useValue: mockWebhookService },
        ],
      }).compile();
      const svc = module.get<RoomStatusService>(RoomStatusService);

      const result = await svc.transitionStatus('room-001', 'prop-001', 'inspected');
      expect(result.status).toBe('inspected');
    });

    it('should transition inspected → guest_ready', async () => {
      const room = { ...mockRoom, status: 'inspected' };
      const db = createMockDb([room]);
      db.update = vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ ...room, status: 'guest_ready' }]),
          }),
        }),
      });
      const module = await Test.createTestingModule({
        providers: [
          RoomStatusService,
          { provide: DRIZZLE, useValue: db },
          { provide: WebhookService, useValue: mockWebhookService },
        ],
      }).compile();
      const svc = module.get<RoomStatusService>(RoomStatusService);

      const result = await svc.transitionStatus('room-001', 'prop-001', 'guest_ready');
      expect(result.status).toBe('guest_ready');
    });

    it('should transition guest_ready → occupied', async () => {
      const room = { ...mockRoom, status: 'guest_ready' };
      const db = createMockDb([room]);
      db.update = vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ ...room, status: 'occupied' }]),
          }),
        }),
      });
      const module = await Test.createTestingModule({
        providers: [
          RoomStatusService,
          { provide: DRIZZLE, useValue: db },
          { provide: WebhookService, useValue: mockWebhookService },
        ],
      }).compile();
      const svc = module.get<RoomStatusService>(RoomStatusService);

      const result = await svc.transitionStatus('room-001', 'prop-001', 'occupied');
      expect(result.status).toBe('occupied');
    });

    it('should transition clean → vacant_dirty (inspection failed)', async () => {
      const room = { ...mockRoom, status: 'clean' };
      const db = createMockDb([room]);
      db.update = vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ ...room, status: 'vacant_dirty' }]),
          }),
        }),
      });
      const module = await Test.createTestingModule({
        providers: [
          RoomStatusService,
          { provide: DRIZZLE, useValue: db },
          { provide: WebhookService, useValue: mockWebhookService },
        ],
      }).compile();
      const svc = module.get<RoomStatusService>(RoomStatusService);

      const result = await svc.transitionStatus('room-001', 'prop-001', 'vacant_dirty');
      expect(result.status).toBe('vacant_dirty');
    });

    it('should transition inspected → vacant_dirty (ready found dirty)', async () => {
      const room = { ...mockRoom, status: 'inspected' };
      const db = createMockDb([room]);
      db.update = vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ ...room, status: 'vacant_dirty' }]),
          }),
        }),
      });
      const module = await Test.createTestingModule({
        providers: [
          RoomStatusService,
          { provide: DRIZZLE, useValue: db },
          { provide: WebhookService, useValue: mockWebhookService },
        ],
      }).compile();
      const svc = module.get<RoomStatusService>(RoomStatusService);

      const result = await svc.transitionStatus('room-001', 'prop-001', 'vacant_dirty');
      expect(result.status).toBe('vacant_dirty');
    });

    it('should transition guest_ready → vacant_dirty (ready found dirty)', async () => {
      const room = { ...mockRoom, status: 'guest_ready' };
      const db = createMockDb([room]);
      db.update = vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ ...room, status: 'vacant_dirty' }]),
          }),
        }),
      });
      const module = await Test.createTestingModule({
        providers: [
          RoomStatusService,
          { provide: DRIZZLE, useValue: db },
          { provide: WebhookService, useValue: mockWebhookService },
        ],
      }).compile();
      const svc = module.get<RoomStatusService>(RoomStatusService);

      const result = await svc.transitionStatus('room-001', 'prop-001', 'vacant_dirty');
      expect(result.status).toBe('vacant_dirty');
    });
  });

  describe('invalid transitions', () => {
    it('should reject occupied → guest_ready', async () => {
      const room = { ...mockRoom, status: 'occupied' };
      const db = createMockDb([room]);
      const module = await Test.createTestingModule({
        providers: [
          RoomStatusService,
          { provide: DRIZZLE, useValue: db },
          { provide: WebhookService, useValue: mockWebhookService },
        ],
      }).compile();
      const svc = module.get<RoomStatusService>(RoomStatusService);

      await expect(
        svc.transitionStatus('room-001', 'prop-001', 'guest_ready'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject vacant_clean → clean', async () => {
      const room = { ...mockRoom, status: 'vacant_clean' };
      const db = createMockDb([room]);
      const module = await Test.createTestingModule({
        providers: [
          RoomStatusService,
          { provide: DRIZZLE, useValue: db },
          { provide: WebhookService, useValue: mockWebhookService },
        ],
      }).compile();
      const svc = module.get<RoomStatusService>(RoomStatusService);

      await expect(
        svc.transitionStatus('room-001', 'prop-001', 'clean'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('shortcut methods', () => {
    it('markOccupied should transition from guest_ready', async () => {
      const room = { ...mockRoom, status: 'guest_ready' };
      const db = createMockDb([room]);
      db.update = vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ ...room, status: 'occupied' }]),
          }),
        }),
      });
      const module = await Test.createTestingModule({
        providers: [
          RoomStatusService,
          { provide: DRIZZLE, useValue: db },
          { provide: WebhookService, useValue: mockWebhookService },
        ],
      }).compile();
      const svc = module.get<RoomStatusService>(RoomStatusService);

      const result = await svc.markOccupied('room-001', 'prop-001');
      expect(result.status).toBe('occupied');
    });

    it('markOccupied should transition from vacant_clean', async () => {
      const room = { ...mockRoom, status: 'vacant_clean' };
      const db = createMockDb([room]);
      db.update = vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ ...room, status: 'occupied' }]),
          }),
        }),
      });
      const module = await Test.createTestingModule({
        providers: [
          RoomStatusService,
          { provide: DRIZZLE, useValue: db },
          { provide: WebhookService, useValue: mockWebhookService },
        ],
      }).compile();
      const svc = module.get<RoomStatusService>(RoomStatusService);

      const result = await svc.markOccupied('room-001', 'prop-001');
      expect(result.status).toBe('occupied');
    });

    it('markVacantDirty should transition from occupied', async () => {
      const room = { ...mockRoom, status: 'occupied' };
      const db = createMockDb([room]);
      db.update = vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ ...room, status: 'vacant_dirty' }]),
          }),
        }),
      });
      const module = await Test.createTestingModule({
        providers: [
          RoomStatusService,
          { provide: DRIZZLE, useValue: db },
          { provide: WebhookService, useValue: mockWebhookService },
        ],
      }).compile();
      const svc = module.get<RoomStatusService>(RoomStatusService);

      const result = await svc.markVacantDirty('room-001', 'prop-001');
      expect(result.status).toBe('vacant_dirty');
    });

    it('markOutOfOrder should set maintenance notes', async () => {
      const room = { ...mockRoom, status: 'vacant_clean' };
      const db = createMockDb([room]);
      db.update = vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ ...room, status: 'out_of_order', maintenanceNotes: 'Broken AC' }]),
          }),
        }),
      });
      const module = await Test.createTestingModule({
        providers: [
          RoomStatusService,
          { provide: DRIZZLE, useValue: db },
          { provide: WebhookService, useValue: mockWebhookService },
        ],
      }).compile();
      const svc = module.get<RoomStatusService>(RoomStatusService);

      const result = await svc.markOutOfOrder('room-001', 'prop-001', 'Broken AC');
      expect(result.status).toBe('out_of_order');
      expect(result.maintenanceNotes).toBe('Broken AC');
    });

    it('markBackInService from out_of_order', async () => {
      const room = { ...mockRoom, status: 'out_of_order' };
      const db = createMockDb([room]);
      db.update = vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ ...room, status: 'vacant_dirty' }]),
          }),
        }),
      });
      const module = await Test.createTestingModule({
        providers: [
          RoomStatusService,
          { provide: DRIZZLE, useValue: db },
          { provide: WebhookService, useValue: mockWebhookService },
        ],
      }).compile();
      const svc = module.get<RoomStatusService>(RoomStatusService);

      const result = await svc.markBackInService('room-001', 'prop-001');
      expect(result.status).toBe('vacant_dirty');
    });
  });

  describe('queries', () => {
    it('getPropertyRoomSummary should return counts', async () => {
      const summary = [
        { status: 'vacant_clean', count: 10 },
        { status: 'occupied', count: 5 },
      ];
      const db = {
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              groupBy: vi.fn().mockResolvedValue(summary),
            }),
          }),
        })),
        update: vi.fn(),
      };
      const module = await Test.createTestingModule({
        providers: [
          RoomStatusService,
          { provide: DRIZZLE, useValue: db },
          { provide: WebhookService, useValue: mockWebhookService },
        ],
      }).compile();
      const svc = module.get<RoomStatusService>(RoomStatusService);

      const result = await svc.getPropertyRoomSummary('prop-001');
      expect(result).toEqual(summary);
    });
  });

  describe('webhook emission', () => {
    it('should emit room.status_changed on valid transition', async () => {
      const room = { ...mockRoom, status: 'vacant_clean' };
      const db = createMockDb([room]);
      db.update = vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ ...room, status: 'occupied' }]),
          }),
        }),
      });
      const module = await Test.createTestingModule({
        providers: [
          RoomStatusService,
          { provide: DRIZZLE, useValue: db },
          { provide: WebhookService, useValue: mockWebhookService },
        ],
      }).compile();
      const svc = module.get<RoomStatusService>(RoomStatusService);

      await svc.transitionStatus('room-001', 'prop-001', 'occupied');
      expect(mockWebhookService.emit).toHaveBeenCalledWith(
        'room.status_changed',
        'room',
        'room-001',
        expect.objectContaining({ previousStatus: 'vacant_clean', newStatus: 'occupied' }),
        'prop-001',
      );
    });
  });

  describe('error cases', () => {
    it('should throw NotFoundException for non-existent room', async () => {
      const db = createMockDb([]);
      const module = await Test.createTestingModule({
        providers: [
          RoomStatusService,
          { provide: DRIZZLE, useValue: db },
          { provide: WebhookService, useValue: mockWebhookService },
        ],
      }).compile();
      const svc = module.get<RoomStatusService>(RoomStatusService);

      await expect(
        svc.transitionStatus('nonexistent', 'prop-001', 'occupied'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
