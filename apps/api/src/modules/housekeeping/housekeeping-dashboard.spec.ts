import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { HousekeepingService } from './housekeeping.service';
import { DRIZZLE } from '../../database/database.module';
import { WebhookService } from '../webhook/webhook.service';
import { RoomStatusService } from '../room/room-status.service';

const mockWebhookService = { emit: vi.fn().mockResolvedValue(undefined) };
const mockRoomStatusService = {
  transitionStatus: vi.fn().mockResolvedValue({ id: 'room-001', status: 'clean' }),
  getRoomStatus: vi.fn().mockResolvedValue({ id: 'room-001', number: '101', status: 'vacant_dirty' }),
  getRoomsByStatus: vi.fn().mockResolvedValue([]),
  getPropertyRoomSummary: vi.fn().mockResolvedValue([
    { status: 'occupied', count: 30 },
    { status: 'vacant_dirty', count: 10 },
    { status: 'guest_ready', count: 5 },
    { status: 'clean', count: 3 },
  ]),
};

function createDashboardDb() {
  let selectCallCount = 0;
  return {
    select: vi.fn().mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          groupBy: vi.fn().mockReturnValue({
            then: (resolve: any) => {
              selectCallCount++;
              if (selectCallCount === 1) {
                // Task summary
                resolve([
                  { status: 'pending', count: 5 },
                  { status: 'assigned', count: 3 },
                  { status: 'completed', count: 8 },
                ]);
              } else if (selectCallCount === 2) {
                // Housekeeper summary
                resolve([
                  { housekeeperId: 'hk-001', tasksAssigned: 6, tasksCompleted: 4, tasksInProgress: 1, avgTurnTimeMinutes: 25 },
                  { housekeeperId: 'hk-002', tasksAssigned: 5, tasksCompleted: 4, tasksInProgress: 0, avgTurnTimeMinutes: 30 },
                ]);
              } else {
                resolve([]);
              }
            },
          }),
          orderBy: vi.fn().mockReturnValue({
            then: (resolve: any) => resolve([]), // urgent rooms
            limit: vi.fn().mockReturnValue({
              offset: vi.fn().mockReturnValue({
                then: (resolve: any) => resolve([]),
              }),
            }),
          }),
          then: (resolve: any) => resolve([]),
        }),
        leftJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              then: (resolve: any) => resolve([]), // urgent rooms
            }),
            groupBy: vi.fn().mockReturnValue({
              then: (resolve: any) => resolve([]),
            }),
            then: (resolve: any) => resolve([]),
          }),
          leftJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              groupBy: vi.fn().mockReturnValue({
                then: (resolve: any) => resolve([]),
              }),
              then: (resolve: any) => resolve([]),
            }),
          }),
        }),
      }),
    })),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockReturnValue({
          then: (resolve: any) => resolve([{ id: 'new-task' }]),
        }),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockReturnValue({
            then: (resolve: any) => resolve([]),
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

describe('HousekeepingService — Dashboard & Analytics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRoomStatusService.getPropertyRoomSummary.mockResolvedValue([
      { status: 'occupied', count: 30 },
      { status: 'vacant_dirty', count: 10 },
      { status: 'guest_ready', count: 5 },
      { status: 'clean', count: 3 },
    ]);
  });

  it('should return room summary with correct counts', async () => {
    const db = createDashboardDb();
    const svc = await createService(db);
    const result = await svc.getDashboard('prop-001', '2026-04-06');
    expect(result.roomSummary.occupied).toBe(30);
    expect(result.roomSummary.vacant_dirty).toBe(10);
    expect(result.roomSummary.guest_ready).toBe(5);
    expect(result.roomSummary.total).toBe(48);
  });

  it('should return task summary with correct counts', async () => {
    const db = createDashboardDb();
    const svc = await createService(db);
    const result = await svc.getDashboard('prop-001', '2026-04-06');
    expect(result.taskSummary.pending).toBe(5);
    expect(result.taskSummary.assigned).toBe(3);
    expect(result.taskSummary.completed).toBe(8);
    expect(result.taskSummary.total).toBe(16);
  });

  it('should return housekeeper summary with avg turn time', async () => {
    const db = createDashboardDb();
    const svc = await createService(db);
    const result = await svc.getDashboard('prop-001', '2026-04-06');
    expect(result.housekeeperSummary).toHaveLength(2);
    expect(result.housekeeperSummary[0].housekeeperId).toBe('hk-001');
    expect(result.housekeeperSummary[0].avgTurnTimeMinutes).toBe(25);
  });

  it('should return analytics with period metrics', async () => {
    const analyticsDb = createDashboardDb();
    // Override for analytics queries
    let analyticsCallCount = 0;
    analyticsDb.select = vi.fn().mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          groupBy: vi.fn().mockReturnValue({
            then: (resolve: any) => {
              analyticsCallCount++;
              if (analyticsCallCount === 1) {
                // tasks by type
                resolve([{ type: 'checkout', count: 15 }, { type: 'stayover', count: 10 }]);
              } else {
                // by housekeeper
                resolve([{ housekeeperId: 'hk-001', tasksCompleted: 12, avgTurnTimeMinutes: 25 }]);
              }
            },
          }),
          then: (resolve: any) => {
            // Overall metrics
            resolve([{
              avgTurnTimeMinutes: 27.5,
              medianTurnTimeMinutes: 25,
              totalTasksCompleted: 25,
              maintenanceIssueCount: 3,
              inspectedCount: 20,
            }]);
          },
        }),
        leftJoin: vi.fn().mockReturnValue({
          leftJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              groupBy: vi.fn().mockReturnValue({
                then: (resolve: any) => resolve([{ roomTypeName: 'Standard King', avgTurnTimeMinutes: 25, taskCount: 10 }]),
              }),
            }),
          }),
          where: vi.fn().mockReturnValue({
            groupBy: vi.fn().mockReturnValue({
              then: (resolve: any) => resolve([]),
            }),
          }),
        }),
      }),
    }));
    const svc = await createService(analyticsDb);
    const result = await svc.getAnalytics('prop-001', '2026-04-01', '2026-04-06');
    expect(result.period.start).toBe('2026-04-01');
    expect(result.period.end).toBe('2026-04-06');
    expect(result.metrics.avgTurnTimeMinutes).toBe(27.5);
    expect(result.metrics.totalTasksCompleted).toBe(25);
  });

  it('should generate stayover tasks for occupied rooms', async () => {
    mockRoomStatusService.getRoomsByStatus.mockResolvedValueOnce([
      { id: 'room-001' },
      { id: 'room-002' },
    ]);
    const db = createDashboardDb();
    // Each room iteration runs through the where→then mock (in order):
    //   1) duplicate stayover check (empty),
    //   2) FK ownership check on rooms in create() (audit #6 — must return a row),
    //   3) ADA accessible lookup inside generateChecklist (empty).
    // The VIP reservation lookup uses leftJoin and goes through a different path
    // (still []). So the where.then path cycles every 3 calls.
    let nWhere = 0;
    db.select = vi.fn().mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          then: (resolve: any) => {
            nWhere++;
            const inRoom = ((nWhere - 1) % 3) + 1;
            resolve(inRoom === 2 ? [{ id: 'room-fk' }] : []);
          },
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              then: (resolve: any) => resolve([]),
            }),
          }),
        }),
        leftJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                then: (resolve: any) => resolve([]),
              }),
            }),
            then: (resolve: any) => resolve([]),
          }),
        }),
      }),
    }));
    const svc = await createService(db);
    const result = await svc.generateStayoverTasks('prop-001', '2026-04-06');
    expect(result.created).toBe(2);
    expect(result.skipped).toBe(0);
    expect(db.insert).toHaveBeenCalledTimes(2);
  });

  it('should not create duplicate stayover tasks', async () => {
    mockRoomStatusService.getRoomsByStatus.mockResolvedValueOnce([
      { id: 'room-001' },
    ]);
    const db = createDashboardDb();
    // Return existing task for duplicate check
    db.select = vi.fn().mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          then: (resolve: any) => resolve([{ id: 'existing-task' }]), // existing stayover
        }),
        leftJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            then: (resolve: any) => resolve([]),
          }),
        }),
      }),
    }));
    const svc = await createService(db);
    const result = await svc.generateStayoverTasks('prop-001', '2026-04-06');
    expect(result.created).toBe(0);
    expect(result.skipped).toBe(1);
    expect(db.insert).not.toHaveBeenCalled();
  });
});
