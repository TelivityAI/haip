import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { AllotmentService } from './allotment.service';
import { WebhookService } from '../webhook/webhook.service';
import { AvailabilityService } from '../reservation/availability.service';
import { DRIZZLE } from '../../database/database.module';

const mockBlock = {
  id: 'block-001',
  propertyId: 'prop-001',
  groupProfileId: 'grp-001',
  name: 'Conf Block',
  ratePlanId: 'rate-001',
  startDate: '2026-06-01',
  endDate: '2026-06-05',
  cutoffDate: '2026-05-15',
  autoRelease: true,
  status: 'tentative',
  createdAt: new Date(),
  updatedAt: new Date(),
};

function createMockDb(returnData: any[] = [mockBlock]) {
  const selectChain = () => ({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockReturnValue({
          offset: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue(returnData),
          }),
        }),
        orderBy: vi.fn().mockResolvedValue(returnData),
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

  const db: any = {
    select: vi.fn().mockImplementation(selectChain),
    insert: vi.fn().mockReturnValue(mutateChain()),
    update: vi.fn().mockReturnValue(mutateChain()),
    delete: vi.fn().mockReturnValue(mutateChain()),
  };
  db.transaction = vi.fn().mockImplementation((cb: any) => cb(db));
  return db;
}

const mockWebhookService = { emit: vi.fn() };

function mockAvailability(available: number) {
  return {
    searchAvailability: vi.fn().mockResolvedValue([
      { roomTypeId: 'rt-001', date: '2026-06-02', available },
    ]),
  } as unknown as AvailabilityService;
}

async function buildService(db: any, availability: AvailabilityService) {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      AllotmentService,
      { provide: DRIZZLE, useValue: db },
      { provide: WebhookService, useValue: mockWebhookService },
      { provide: AvailabilityService, useValue: availability },
    ],
  }).compile();
  return module.get<AllotmentService>(AllotmentService);
}

describe('AllotmentService', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('createBlock', () => {
    it('creates a block and emits group.block_created', async () => {
      const svc = await buildService(createMockDb(), mockAvailability(20));
      const result = await svc.createBlock({
        propertyId: 'prop-001',
        groupProfileId: 'grp-001',
        name: 'Conf Block',
        startDate: '2026-06-01',
        endDate: '2026-06-05',
      });
      expect(result.id).toBe('block-001');
      expect(mockWebhookService.emit).toHaveBeenCalledWith(
        'group.block_created',
        'allotment_block',
        'block-001',
        expect.any(Object),
        'prop-001',
      );
    });

    it('rejects endDate <= startDate', async () => {
      const svc = await buildService(createMockDb(), mockAvailability(20));
      await expect(
        svc.createBlock({
          propertyId: 'prop-001',
          groupProfileId: 'grp-001',
          name: 'X',
          startDate: '2026-06-05',
          endDate: '2026-06-01',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('findBlockById', () => {
    it('throws NotFound when missing', async () => {
      const svc = await buildService(createMockDb([]), mockAvailability(20));
      await expect(svc.findBlockById('nope', 'prop-001')).rejects.toThrow(NotFoundException);
    });
  });

  describe('setInventory', () => {
    it('inserts a new inventory row within sellable availability', async () => {
      // After the FK-ownership fix in setInventory, the select sequence is now:
      //   1=findBlockById → block, 2=roomTypes FK check → row, 3+=inventory lookup → empty.
      const db = createMockDb([mockBlock]);
      let call = 0;
      db.select = vi.fn().mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              offset: vi.fn().mockReturnValue({ orderBy: vi.fn().mockResolvedValue([]) }),
            }),
            orderBy: vi.fn().mockResolvedValue([]),
            then: (resolve: any) => {
              call++;
              if (call === 1) return resolve([mockBlock]);          // findBlockById
              if (call === 2) return resolve([{ id: 'rt-001' }]);   // roomTypes FK OK
              return resolve([]);                                    // inventory lookup empty
            },
          }),
        }),
      }));
      db.insert = vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([
            { id: 'inv-001', roomsAllotted: 5, roomsPickedUp: 0 },
          ]),
        }),
      });
      const svc = await buildService(db, mockAvailability(10));
      const result = await svc.setInventory('block-001', 'prop-001', {
        propertyId: 'prop-001',
        stayDate: '2026-06-02',
        roomTypeId: 'rt-001',
        roomsAllotted: 5,
      });
      expect(result.id).toBe('inv-001');
      expect(mockWebhookService.emit).toHaveBeenCalledWith(
        'group.inventory_set',
        'allotment_block',
        'block-001',
        expect.any(Object),
        'prop-001',
      );
    });

    it('rejects over-allotment beyond sellable availability', async () => {
      const db = createMockDb([mockBlock]);
      let call = 0;
      db.select = vi.fn().mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            then: (resolve: any) => {
              call++;
              if (call === 1) return resolve([mockBlock]);          // findBlockById
              if (call === 2) return resolve([{ id: 'rt-001' }]);   // roomTypes FK OK
              return resolve([]);                                    // existing inventory empty
            },
          }),
        }),
      }));
      const svc = await buildService(db, mockAvailability(3));
      await expect(
        svc.setInventory('block-001', 'prop-001', {
          propertyId: 'prop-001',
          stayDate: '2026-06-02',
          roomTypeId: 'rt-001',
          roomsAllotted: 10,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects setting inventory on a released block', async () => {
      const svc = await buildService(
        createMockDb([{ ...mockBlock, status: 'released' }]),
        mockAvailability(10),
      );
      await expect(
        svc.setInventory('block-001', 'prop-001', {
          propertyId: 'prop-001',
          stayDate: '2026-06-02',
          roomTypeId: 'rt-001',
          roomsAllotted: 1,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('allows inventory on shoulder start before core block start', async () => {
      const blockWithShoulder = {
        ...mockBlock,
        startDate: '2026-06-01',
        endDate: '2026-06-05',
        shoulderStart: '2026-05-29',
        shoulderEnd: '2026-06-07',
      };
      const db = createMockDb([blockWithShoulder]);
      let call = 0;
      db.select = vi.fn().mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              offset: vi.fn().mockReturnValue({ orderBy: vi.fn().mockResolvedValue([]) }),
            }),
            orderBy: vi.fn().mockResolvedValue([]),
            then: (resolve: any) => {
              call++;
              if (call === 1) return resolve([blockWithShoulder]);
              if (call === 2) return resolve([{ id: 'rt-001' }]);
              return resolve([]);
            },
          }),
        }),
      }));
      db.insert = vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([
            { id: 'inv-shoulder', roomsAllotted: 3, roomsPickedUp: 0 },
          ]),
        }),
      });
      const availability = {
        searchAvailability: vi.fn().mockResolvedValue([
          { roomTypeId: 'rt-001', date: '2026-05-30', available: 10 },
        ]),
      } as unknown as AvailabilityService;
      const svc = await buildService(db, availability);
      const result = await svc.setInventory('block-001', 'prop-001', {
        propertyId: 'prop-001',
        stayDate: '2026-05-30',
        roomTypeId: 'rt-001',
        roomsAllotted: 3,
      });
      expect(result.id).toBe('inv-shoulder');
    });

    it('rejects inventory before shoulder-inclusive span', async () => {
      const blockWithShoulder = {
        ...mockBlock,
        startDate: '2026-06-01',
        endDate: '2026-06-05',
        shoulderStart: '2026-05-29',
        shoulderEnd: '2026-06-07',
      };
      const db = createMockDb([blockWithShoulder]);
      let call = 0;
      db.select = vi.fn().mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            then: (resolve: any) => {
              call++;
              if (call === 1) return resolve([blockWithShoulder]);
              return resolve([]);
            },
          }),
        }),
      }));
      const svc = await buildService(db, mockAvailability(10));
      await expect(
        svc.setInventory('block-001', 'prop-001', {
          propertyId: 'prop-001',
          stayDate: '2026-05-28',
          roomTypeId: 'rt-001',
          roomsAllotted: 1,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects inventory on or after shoulder span end (exclusive)', async () => {
      const blockWithShoulder = {
        ...mockBlock,
        startDate: '2026-06-01',
        endDate: '2026-06-05',
        shoulderStart: '2026-05-29',
        shoulderEnd: '2026-06-07',
      };
      const db = createMockDb([blockWithShoulder]);
      let call = 0;
      db.select = vi.fn().mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            then: (resolve: any) => {
              call++;
              if (call === 1) return resolve([blockWithShoulder]);
              return resolve([]);
            },
          }),
        }),
      }));
      const svc = await buildService(db, mockAvailability(10));
      await expect(
        svc.setInventory('block-001', 'prop-001', {
          propertyId: 'prop-001',
          stayDate: '2026-06-07',
          roomTypeId: 'rt-001',
          roomsAllotted: 1,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getInventorySpan', () => {
    it('uses shoulder dates when present', async () => {
      const svc = await buildService(createMockDb(), mockAvailability(10));
      expect(
        svc.getInventorySpan({
          startDate: '2026-06-01',
          endDate: '2026-06-05',
          shoulderStart: '2026-05-29',
          shoulderEnd: '2026-06-07',
        }),
      ).toEqual({ spanStart: '2026-05-29', spanEndExclusive: '2026-06-07' });
    });

    it('falls back to core block dates when shoulders unset', async () => {
      const svc = await buildService(createMockDb(), mockAvailability(10));
      expect(
        svc.getInventorySpan({
          startDate: '2026-06-01',
          endDate: '2026-06-05',
        }),
      ).toEqual({ spanStart: '2026-06-01', spanEndExclusive: '2026-06-05' });
    });
  });

  describe('getPickup', () => {
    it('aggregates allotted vs picked up with totals and pickup rate', async () => {
      const db = createMockDb([mockBlock]);
      let call = 0;
      db.select = vi.fn().mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockImplementation(() => {
              return Promise.resolve([
                { stayDate: '2026-06-01', roomTypeId: 'rt-001', roomsAllotted: 10, roomsPickedUp: 4 },
                { stayDate: '2026-06-02', roomTypeId: 'rt-001', roomsAllotted: 10, roomsPickedUp: 6 },
              ]);
            }),
            then: (resolve: any) => {
              call++;
              return resolve([mockBlock]);
            },
          }),
        }),
      }));
      const svc = await buildService(db, mockAvailability(10));
      const result = await svc.getPickup('block-001', 'prop-001');
      expect(result.totals.roomsAllotted).toBe(20);
      expect(result.totals.roomsPickedUp).toBe(10);
      expect(result.totals.remaining).toBe(10);
      expect(result.totals.pickupRate).toBe(0.5);
      expect(result.detail).toHaveLength(2);
    });
  });

  describe('releaseBlock', () => {
    it('marks block released and emits group.block_released', async () => {
      const db = createMockDb([{ ...mockBlock, status: 'released' }]);
      // findBlockById should see a non-released block first
      let call = 0;
      db.select = vi.fn().mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            then: (resolve: any) => {
              call++;
              return resolve([{ ...mockBlock, status: 'tentative' }]);
            },
          }),
        }),
      }));
      const svc = await buildService(db, mockAvailability(10));
      const result = await svc.releaseBlock('block-001', 'prop-001');
      expect(result.status).toBe('released');
      expect(mockWebhookService.emit).toHaveBeenCalledWith(
        'group.block_released',
        'allotment_block',
        'block-001',
        expect.any(Object),
        'prop-001',
      );
    });

    it('rejects releasing an already released block', async () => {
      const svc = await buildService(
        createMockDb([{ ...mockBlock, status: 'released' }]),
        mockAvailability(10),
      );
      await expect(svc.releaseBlock('block-001', 'prop-001')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('processCutoffs', () => {
    it('releases each due block and returns the count', async () => {
      const db = createMockDb();
      // First select (due list) returns two ids; subsequent findBlockById calls
      // return a tentative block.
      let call = 0;
      db.select = vi.fn().mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            then: (resolve: any) => {
              call++;
              if (call === 1) return resolve([{ id: 'b1' }, { id: 'b2' }]);
              return resolve([{ ...mockBlock, status: 'tentative' }]);
            },
          }),
        }),
      }));
      const svc = await buildService(db, mockAvailability(10));
      const result = await svc.processCutoffs('prop-001');
      expect(result.released).toBe(2);
    });
  });
});
