import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { HousekeepingService } from './housekeeping.service';
import { DRIZZLE } from '../../database/database.module';
import { WebhookService } from '../webhook/webhook.service';
import { RoomStatusService } from '../room/room-status.service';
import { CHECKLIST_TEMPLATES, ADA_EXTRA_ITEMS, VIP_EXTRA_ITEMS } from './checklist-templates';

const mockWebhookService = { emit: vi.fn().mockResolvedValue(undefined) };
const mockRoomStatusService = {
  transitionStatus: vi.fn().mockResolvedValue({ id: 'room-001', status: 'clean' }),
  getRoomStatus: vi.fn().mockResolvedValue({ id: 'room-001', number: '101', status: 'vacant_dirty' }),
  getRoomsByStatus: vi.fn().mockResolvedValue([]),
  getPropertyRoomSummary: vi.fn().mockResolvedValue([]),
};

const mockTask = {
  id: 'task-001',
  propertyId: 'prop-001',
  roomId: 'room-001',
  type: 'checkout',
  status: 'pending',
  priority: 0,
  serviceDate: '2026-04-06',
  checklist: [],
  notes: null,
  maintenanceRequired: false,
  assignedTo: null,
  assignedAt: null,
  startedAt: null,
  completedAt: null,
  inspectedBy: null,
  inspectedAt: null,
};

function createMockDb(options: {
  selectResult?: any;
  insertResult?: any;
  updateResult?: any;
  deleteResult?: any;
} = {}) {
  const selectResult = options.selectResult ?? [mockTask];
  const insertResult = options.insertResult ?? [mockTask];
  const updateResult = options.updateResult ?? [{ ...mockTask, status: 'assigned' }];

  let selectCallCount = 0;
  const selectResults: any[] = Array.isArray(selectResult[0]) ? selectResult : [selectResult];

  return {
    select: vi.fn().mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          then: (resolve: any) => {
            const result = selectResults[selectCallCount] ?? selectResults[selectResults.length - 1];
            selectCallCount++;
            resolve(result);
          },
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              offset: vi.fn().mockReturnValue({
                then: (resolve: any) => resolve(selectResult),
              }),
            }),
            then: (resolve: any) => resolve(selectResult),
          }),
          groupBy: vi.fn().mockReturnValue({
            then: (resolve: any) => resolve(selectResult),
          }),
          limit: vi.fn().mockReturnValue({
            then: (resolve: any) => resolve(selectResult),
          }),
        }),
        leftJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            then: (resolve: any) => {
              const result = selectResults[selectCallCount] ?? selectResults[selectResults.length - 1];
              selectCallCount++;
              resolve(result);
            },
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                offset: vi.fn().mockReturnValue({
                  then: (resolve: any) => {
                    const result = selectResults[selectCallCount] ?? selectResults[selectResults.length - 1];
                    selectCallCount++;
                    resolve(result);
                  },
                }),
                then: (resolve: any) => {
                  const result = selectResults[selectCallCount] ?? selectResults[selectResults.length - 1];
                  selectCallCount++;
                  resolve(result);
                },
              }),
              then: (resolve: any) => {
                const result = selectResults[selectCallCount] ?? selectResults[selectResults.length - 1];
                selectCallCount++;
                resolve(result);
              },
            }),
            groupBy: vi.fn().mockReturnValue({
              then: (resolve: any) => resolve(selectResult),
            }),
          }),
          leftJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              groupBy: vi.fn().mockReturnValue({
                then: (resolve: any) => resolve(selectResult),
              }),
              then: (resolve: any) => resolve(selectResult),
            }),
          }),
        }),
      }),
    })),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockReturnValue({
          then: (resolve: any) => resolve(insertResult),
        }),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockReturnValue({
            then: (resolve: any) => resolve(updateResult),
          }),
        }),
      }),
    }),
    delete: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        then: (resolve: any) => resolve(undefined),
      }),
    }),
  };
}

async function createService(db: any) {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      HousekeepingService,
      { provide: DRIZZLE, useValue: db },
      { provide: WebhookService, useValue: mockWebhookService },
      { provide: RoomStatusService, useValue: mockRoomStatusService },
    ],
  }).compile();

  return module.get<HousekeepingService>(HousekeepingService);
}

describe('HousekeepingService — CRUD', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create task with custom checklist', async () => {
    const customChecklist = [{ item: 'Custom item', checked: false }];
    const db = createMockDb({ insertResult: [{ ...mockTask, checklist: customChecklist }] });
    const svc = await createService(db);
    const result = await svc.create({
      propertyId: 'prop-001',
      roomId: 'room-001',
      type: 'checkout',
      serviceDate: '2026-04-06',
      checklist: customChecklist,
    });
    expect(result.checklist).toEqual(customChecklist);
  });

  it('should create task with default checklist template when none provided', async () => {
    // DB calls: 1=FK ownership (room is same-property), 2=room lookup
    // (isAccessible), 3=reservation+guest lookup (VIP), 4=insert
    const db = createMockDb({
      selectResult: [
        [{ id: 'room-001' }],            // FK ownership check — room belongs to dto.propertyId
        [{ isAccessible: false }],       // room lookup
        [],                               // no incoming reservation
      ],
      insertResult: [{ ...mockTask, checklist: CHECKLIST_TEMPLATES.checkout }],
    });
    const svc = await createService(db);
    const result = await svc.create({
      propertyId: 'prop-001',
      roomId: 'room-001',
      type: 'checkout',
      serviceDate: '2026-04-06',
    });
    // Verify insert was called (checklist generated from template)
    expect(db.insert).toHaveBeenCalled();
    expect(result.checklist).toEqual(CHECKLIST_TEMPLATES.checkout);
  });

  it('should add ADA extra items for accessible rooms', async () => {
    const expectedChecklist = [...CHECKLIST_TEMPLATES.checkout, ...ADA_EXTRA_ITEMS];
    const db = createMockDb({
      selectResult: [
        [{ id: 'room-001' }],       // FK ownership check (audit #6)
        [{ isAccessible: true }],   // room is ADA accessible
        [],                          // no incoming reservation
      ],
      insertResult: [{ ...mockTask, checklist: expectedChecklist }],
    });
    const svc = await createService(db);
    await svc.create({
      propertyId: 'prop-001',
      roomId: 'room-001',
      type: 'checkout',
      serviceDate: '2026-04-06',
    });
    // Verify insert values included ADA items
    const insertValues = db.insert.mock.results[0].value.values.mock.calls[0][0];
    expect(insertValues.checklist.length).toBe(CHECKLIST_TEMPLATES.checkout.length + ADA_EXTRA_ITEMS.length);
  });

  it('should add VIP extra items when next guest is VIP', async () => {
    const db = createMockDb({
      selectResult: [
        [{ id: 'room-001' }],              // FK ownership check (audit #6)
        [{ isAccessible: false }],         // room not accessible
        [{ vipLevel: 'gold' }],             // VIP guest incoming
      ],
      insertResult: [{ ...mockTask }],
    });
    const svc = await createService(db);
    await svc.create({
      propertyId: 'prop-001',
      roomId: 'room-001',
      type: 'checkout',
      serviceDate: '2026-04-06',
    });
    const insertValues = db.insert.mock.results[0].value.values.mock.calls[0][0];
    expect(insertValues.checklist.length).toBe(CHECKLIST_TEMPLATES.checkout.length + VIP_EXTRA_ITEMS.length);
  });

  it('should find task by id with room details', async () => {
    const db = createMockDb({
      selectResult: [[{
        task: mockTask,
        roomNumber: '101',
        roomFloor: '1',
        roomBuilding: 'Main',
      }]],
    });
    const svc = await createService(db);
    const result = await svc.findById('task-001', 'prop-001');
    expect(result.room).toEqual({ number: '101', floor: '1', building: 'Main' });
  });

  it('should throw NotFoundException for missing task', async () => {
    const db = createMockDb({ selectResult: [[]] });
    const svc = await createService(db);
    await expect(svc.findById('missing', 'prop-001')).rejects.toThrow('not found');
  });

  it('should list tasks with pagination', async () => {
    const db = createMockDb({ selectResult: [mockTask] });
    // Override the Promise.all pattern - list uses parallel queries with leftJoin
    db.select = vi.fn().mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        leftJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                offset: vi.fn().mockReturnValue({
                  then: (resolve: any) => resolve([{ task: mockTask, roomNumber: '101' }]),
                }),
              }),
            }),
            then: (resolve: any) => resolve([{ count: 1 }]),
          }),
        }),
        where: vi.fn().mockReturnValue({
          then: (resolve: any) => resolve([{ count: 1 }]),
        }),
      }),
    }));
    const svc = await createService(db);
    const result = await svc.list({ propertyId: 'prop-001' });
    expect(result.data).toHaveLength(1);
    expect(result.total).toBe(1);
    expect(result.page).toBe(1);
  });

  it('should update task fields', async () => {
    const updatedTask = { ...mockTask, priority: 10, notes: 'Updated' };
    const db = createMockDb({
      selectResult: [[mockTask]],
      updateResult: [updatedTask],
    });
    const svc = await createService(db);
    const result = await svc.update('task-001', 'prop-001', { priority: 10, notes: 'Updated' });
    expect(result.priority).toBe(10);
  });

  it('should reject update on completed task', async () => {
    const completedTask = { ...mockTask, status: 'completed' };
    const db = createMockDb({ selectResult: [[completedTask]] });
    const svc = await createService(db);
    await expect(svc.update('task-001', 'prop-001', { priority: 5 }))
      .rejects.toThrow("Cannot update task in 'completed' status");
  });

  it('should reject update on inspected task', async () => {
    const inspectedTask = { ...mockTask, status: 'inspected' };
    const db = createMockDb({ selectResult: [[inspectedTask]] });
    const svc = await createService(db);
    await expect(svc.update('task-001', 'prop-001', { priority: 5 }))
      .rejects.toThrow("Cannot update task in 'inspected' status");
  });

  it('should delete pending task', async () => {
    const db = createMockDb({ selectResult: [[mockTask]] });
    const svc = await createService(db);
    const result = await svc.delete('task-001', 'prop-001');
    expect(result.deleted).toBe(true);
    expect(db.delete).toHaveBeenCalled();
  });

  it('should reject delete on in_progress task', async () => {
    const inProgressTask = { ...mockTask, status: 'in_progress' };
    const db = createMockDb({ selectResult: [[inProgressTask]] });
    const svc = await createService(db);
    await expect(svc.delete('task-001', 'prop-001'))
      .rejects.toThrow("Cannot delete task in 'in_progress' status");
  });

  it('should reject delete on completed task', async () => {
    const completedTask = { ...mockTask, status: 'completed' };
    const db = createMockDb({ selectResult: [[completedTask]] });
    const svc = await createService(db);
    await expect(svc.delete('task-001', 'prop-001'))
      .rejects.toThrow("Cannot delete task in 'completed' status");
  });

  it('should auto-create checkout task on room.status_changed (vacant_dirty)', async () => {
    const db = createMockDb({
      selectResult: [
        [{ timezone: 'UTC' }],     // 1st select: property timezone (Bug 6)
        [],                         // 2nd select: no existing checkout task (duplicate check)
        [{ isAccessible: false }], // 3rd select: room accessibility check
        [],                         // 4th select: VIP check
      ],
    });
    const svc = await createService(db);
    await svc.handleRoomStatusChanged({
      event: 'room.status_changed',
      entityType: 'room',
      entityId: 'room-001',
      propertyId: 'prop-001',
      data: { newStatus: 'vacant_dirty', previousStatus: 'occupied' },
      timestamp: new Date().toISOString(),
    });
    expect(db.insert).toHaveBeenCalled();
  });

  it('should ignore room.status_changed when not vacant_dirty', async () => {
    const db = createMockDb();
    const svc = await createService(db);
    await svc.handleRoomStatusChanged({
      event: 'room.status_changed',
      entityType: 'room',
      entityId: 'room-001',
      propertyId: 'prop-001',
      data: { newStatus: 'occupied', previousStatus: 'guest_ready' },
      timestamp: new Date().toISOString(),
    });
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('should list tasks filtered by status', async () => {
    const db = createMockDb();
    db.select = vi.fn().mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        leftJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                offset: vi.fn().mockReturnValue({
                  then: (resolve: any) => resolve([{ task: mockTask, roomNumber: '101' }]),
                }),
              }),
            }),
            then: (resolve: any) => resolve([{ count: 1 }]),
          }),
        }),
        where: vi.fn().mockReturnValue({
          then: (resolve: any) => resolve([{ count: 1 }]),
        }),
      }),
    }));
    const svc = await createService(db);
    const result = await svc.list({ propertyId: 'prop-001', status: 'pending' });
    expect(result.data).toHaveLength(1);
  });

  it('should list tasks filtered by type', async () => {
    const db = createMockDb();
    db.select = vi.fn().mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        leftJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                offset: vi.fn().mockReturnValue({
                  then: (resolve: any) => resolve([{ task: mockTask, roomNumber: '101' }]),
                }),
              }),
            }),
            then: (resolve: any) => resolve([{ count: 1 }]),
          }),
        }),
        where: vi.fn().mockReturnValue({
          then: (resolve: any) => resolve([{ count: 1 }]),
        }),
      }),
    }));
    const svc = await createService(db);
    const result = await svc.list({ propertyId: 'prop-001', type: 'checkout' });
    expect(result.data).toHaveLength(1);
  });

  it('should list tasks filtered by serviceDate', async () => {
    const db = createMockDb();
    db.select = vi.fn().mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        leftJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                offset: vi.fn().mockReturnValue({
                  then: (resolve: any) => resolve([{ task: mockTask, roomNumber: '101' }]),
                }),
              }),
            }),
            then: (resolve: any) => resolve([{ count: 1 }]),
          }),
        }),
        where: vi.fn().mockReturnValue({
          then: (resolve: any) => resolve([{ count: 1 }]),
        }),
      }),
    }));
    const svc = await createService(db);
    const result = await svc.list({ propertyId: 'prop-001', serviceDate: '2026-04-06' });
    expect(result.data).toHaveLength(1);
  });
});

describe('HousekeepingService.getOpsForecast', () => {
  async function createService(db: any) {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HousekeepingService,
        { provide: DRIZZLE, useValue: db },
        { provide: WebhookService, useValue: mockWebhookService },
        { provide: RoomStatusService, useValue: mockRoomStatusService },
      ],
    }).compile();
    return module.get(HousekeepingService);
  }

  it('returns checkout and stayover counts for the service date', async () => {
    let selectCall = 0;
    const db = {
      select: vi.fn().mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            then: (resolve: (v: unknown) => void) => {
              selectCall++;
              resolve([{ count: selectCall === 1 ? 4 : 11 }]);
            },
          }),
        }),
      })),
    };
    const svc = await createService(db);
    const result = await svc.getOpsForecast('prop-001', '2026-04-07');
    expect(result).toEqual({
      date: '2026-04-07',
      expectedCheckouts: 4,
      expectedStayovers: 11,
    });
    expect(db.select).toHaveBeenCalledTimes(2);
  });

  it('returns zero counts when no matching reservations', async () => {
    const db = {
      select: vi.fn().mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            then: (resolve: (v: unknown) => void) => resolve([{ count: 0 }]),
          }),
        }),
      })),
    };
    const svc = await createService(db);
    const result = await svc.getOpsForecast('prop-001', '2026-04-07');
    expect(result.expectedCheckouts).toBe(0);
    expect(result.expectedStayovers).toBe(0);
  });
});
