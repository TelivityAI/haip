import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { ReportsService } from './reports.service';
import { DRIZZLE } from '../../database/database.module';

function createMockDb(selectResults: any[][] = [[]]) {
  let selectCallCount = 0;

  return {
    select: vi.fn().mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          then: (resolve: any) => {
            const result = selectResults[selectCallCount] ?? selectResults[selectResults.length - 1]!;
            selectCallCount++;
            resolve(result);
          },
          groupBy: vi.fn().mockReturnValue({
            then: (resolve: any) => {
              const result = selectResults[selectCallCount] ?? selectResults[selectResults.length - 1]!;
              selectCallCount++;
              resolve(result);
            },
            orderBy: vi.fn().mockReturnValue({
              then: (resolve: any) => {
                const result = selectResults[selectCallCount] ?? selectResults[selectResults.length - 1]!;
                selectCallCount++;
                resolve(result);
              },
            }),
          }),
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              then: (resolve: any) => {
                const result = selectResults[selectCallCount] ?? selectResults[selectResults.length - 1]!;
                selectCallCount++;
                resolve(result);
              },
            }),
            then: (resolve: any) => {
              const result = selectResults[selectCallCount] ?? selectResults[selectResults.length - 1]!;
              selectCallCount++;
              resolve(result);
            },
          }),
        }),
        leftJoin: vi.fn().mockImplementation(() => {
          const groupByFn = vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              then: (resolve: any) => {
                const result = selectResults[selectCallCount] ?? selectResults[selectResults.length - 1]!;
                selectCallCount++;
                resolve(result);
              },
            }),
            then: (resolve: any) => {
              const result = selectResults[selectCallCount] ?? selectResults[selectResults.length - 1]!;
              selectCallCount++;
              resolve(result);
            },
          });
          return {
            groupBy: groupByFn,
            where: vi.fn().mockReturnValue({
              groupBy: groupByFn,
            }),
          };
        }),
      }),
    })),
  };
}

describe('ReportsService', () => {
  let service: ReportsService;

  beforeEach(async () => {
    vi.clearAllMocks();
  });

  // --- Daily Revenue ---

  it('should sum charges by type for daily revenue', async () => {
    const db = createMockDb([
      // revenue by type
      [
        { type: 'room', total: '3000.00' },
        { type: 'tax', total: '300.00' },
        { type: 'food_beverage', total: '500.00' },
      ],
      // adjustments (reversals)
      [{ total: '50.00' }],
      // payments by method
      [
        { method: 'credit_card', total: '3500.00' },
        { method: 'cash', total: '250.00' },
      ],
    ]);
    const module = await Test.createTestingModule({
      providers: [
        ReportsService,
        { provide: DRIZZLE, useValue: db },
      ],
    }).compile();
    service = module.get(ReportsService);

    const result = await service.getDailyRevenue('prop-001', '2026-04-06');
    expect(result.revenue.room).toBe(3000);
    expect(result.revenue.tax).toBe(300);
    expect(result.revenue.foodBeverage).toBe(500);
    expect(result.revenue.total).toBe(3800);
    expect(result.adjustments).toBe(50);
    expect(result.netRevenue).toBe(3750);
  });

  it('should sum payments by method', async () => {
    const db = createMockDb([
      [],               // no charges
      [{ total: '0' }], // no adjustments
      [
        { method: 'credit_card', total: '1000.00' },
        { method: 'cash', total: '200.00' },
        { method: 'city_ledger', total: '500.00' },
      ],
    ]);
    const module = await Test.createTestingModule({
      providers: [
        ReportsService,
        { provide: DRIZZLE, useValue: db },
      ],
    }).compile();
    service = module.get(ReportsService);

    const result = await service.getDailyRevenue('prop-001', '2026-04-06');
    expect(result.payments['credit_card']).toBe(1000);
    expect(result.payments['cash']).toBe(200);
    expect(result.payments['city_ledger']).toBe(500);
    expect(result.payments['total']).toBe(1700);
  });

  // --- Occupancy ---

  it('should calculate occupancy rate correctly', async () => {
    const db = createMockDb([
      // property
      [{ totalRooms: 100 }],
      // room status counts
      [
        { status: 'occupied', count: 60 },
        { status: 'vacant_clean', count: 30 },
        { status: 'out_of_order', count: 5 },
        { status: 'out_of_service', count: 5 },
      ],
      // arrivals
      [{ count: 8 }],
      // departures
      [{ count: 5 }],
      // stayovers
      [{ count: 55 }],
      // no-shows
      [{ count: 2 }],
      // cancellations
      [{ count: 1 }],
    ]);
    const module = await Test.createTestingModule({
      providers: [
        ReportsService,
        { provide: DRIZZLE, useValue: db },
      ],
    }).compile();
    service = module.get(ReportsService);

    const result = await service.getOccupancy('prop-001', '2026-04-06');
    expect(result.totalRooms).toBe(100);
    expect(result.outOfOrder).toBe(5);
    expect(result.outOfService).toBe(5);
    expect(result.availableRooms).toBe(90); // 100 - 5 - 5
    expect(result.occupiedRooms).toBe(60);
    // 60 / 90 = 0.6667
    expect(result.occupancyRate).toBeCloseTo(0.6667, 3);
    expect(result.arrivals).toBe(8);
    expect(result.departures).toBe(5);
    expect(result.noShows).toBe(2);
  });

  it('should exclude OOO/OOS from available rooms', async () => {
    const db = createMockDb([
      [{ totalRooms: 50 }],
      [
        { status: 'occupied', count: 20 },
        { status: 'out_of_order', count: 10 },
        { status: 'out_of_service', count: 5 },
      ],
      [{ count: 0 }], [{ count: 0 }], [{ count: 0 }], [{ count: 0 }], [{ count: 0 }],
    ]);
    const module = await Test.createTestingModule({
      providers: [
        ReportsService,
        { provide: DRIZZLE, useValue: db },
      ],
    }).compile();
    service = module.get(ReportsService);

    const result = await service.getOccupancy('prop-001', '2026-04-06');
    expect(result.availableRooms).toBe(35); // 50 - 10 - 5
    // 20 / 35 = 0.5714
    expect(result.occupancyRate).toBeCloseTo(0.5714, 3);
  });

  // --- Financial Summary ---

  it('should calculate ADR correctly (revenue / rooms sold)', async () => {
    const db = createMockDb([
      // room revenue
      [{ total: '3000.00' }],
      // total revenue
      [{ total: '3500.00' }],
      // revenue by type
      [{ type: 'room', total: '3000.00' }, { type: 'tax', total: '500.00' }],
      // payments by method
      [{ method: 'credit_card', total: '3500.00' }],
      // rooms sold
      [{ count: 20 }],
      // property
      [{ totalRooms: 50 }],
      // room status counts
      [
        { status: 'occupied', count: 20 },
        { status: 'out_of_order', count: 5 },
      ],
      // outstanding balances
      [{ count: 3, totalBalance: '450.00' }],
      // last audit
      [{ businessDate: '2026-04-05', status: 'completed', errors: null }],
    ]);
    const module = await Test.createTestingModule({
      providers: [
        ReportsService,
        { provide: DRIZZLE, useValue: db },
      ],
    }).compile();
    service = module.get(ReportsService);

    const result = await service.getFinancialSummary('prop-001', '2026-04-06');
    // ADR = 3000 / 20 = 150
    expect(result.kpis.adr).toBe(150);
    // available = 50 - 5 = 45, occupancy = 20/45 = 0.4444
    expect(result.kpis.occupancyRate).toBeCloseTo(0.4444, 3);
    // RevPAR = 150 * 0.4444 = 66.67
    expect(result.kpis.revpar).toBeCloseTo(66.67, 0);
    expect(result.outstandingBalances.totalFoliosOpen).toBe(3);
    expect(result.outstandingBalances.totalBalanceDue).toBe(450);
    expect(result.auditStatus.lastAuditDate).toBe('2026-04-05');
  });

  it('should calculate RevPAR correctly (ADR x occupancy)', async () => {
    const db = createMockDb([
      [{ total: '6000.00' }],       // room revenue
      [{ total: '7000.00' }],       // total revenue
      [],                            // revenue by type
      [],                            // payments
      [{ count: 30 }],              // rooms sold
      [{ totalRooms: 50 }],         // property
      [{ status: 'out_of_order', count: 0 }], // room status
      [{ count: 0, totalBalance: '0' }],
      [],                            // no last audit
    ]);
    const module = await Test.createTestingModule({
      providers: [
        ReportsService,
        { provide: DRIZZLE, useValue: db },
      ],
    }).compile();
    service = module.get(ReportsService);

    const result = await service.getFinancialSummary('prop-001', '2026-04-06');
    // ADR = 6000 / 30 = 200
    expect(result.kpis.adr).toBe(200);
    // occupancy = 30 / 50 = 0.6
    // RevPAR = 200 * 0.6 = 120
    expect(result.kpis.revpar).toBe(120);
  });

  it('should return 0 for ADR when no rooms sold (division by zero)', async () => {
    const db = createMockDb([
      [{ total: '0' }],
      [{ total: '0' }],
      [],
      [],
      [{ count: 0 }],         // 0 rooms sold
      [{ totalRooms: 50 }],
      [],
      [{ count: 0, totalBalance: '0' }],
      [],
    ]);
    const module = await Test.createTestingModule({
      providers: [
        ReportsService,
        { provide: DRIZZLE, useValue: db },
      ],
    }).compile();
    service = module.get(ReportsService);

    const result = await service.getFinancialSummary('prop-001', '2026-04-06');
    expect(result.kpis.adr).toBe(0);
    expect(result.kpis.revpar).toBe(0);
  });

  // --- Zero data ---

  it('should return zeros when no data exists (not errors)', async () => {
    const db = createMockDb([
      [],               // no charges
      [{ total: '0' }], // no adjustments
      [],               // no payments
    ]);
    const module = await Test.createTestingModule({
      providers: [
        ReportsService,
        { provide: DRIZZLE, useValue: db },
      ],
    }).compile();
    service = module.get(ReportsService);

    const result = await service.getDailyRevenue('prop-001', '2026-04-06');
    expect(result.revenue.room).toBe(0);
    expect(result.revenue.tax).toBe(0);
    expect(result.revenue.total).toBe(0);
    expect(result.adjustments).toBe(0);
    expect(result.netRevenue).toBe(0);
  });

  // --- Occupancy Trend ---

  it('should return daily breakdown for occupancy trend', async () => {
    const db = createMockDb([
      // property
      [{ totalRooms: 50 }],
      // room status counts
      [{ status: 'out_of_order', count: 5 }],
      // daily revenue
      [
        { date: '2026-04-04', revenue: '3000.00' },
        { date: '2026-04-05', revenue: '3500.00' },
        { date: '2026-04-06', revenue: '2500.00' },
      ],
      // daily rooms sold
      [
        { date: '2026-04-04', count: 20 },
        { date: '2026-04-05', count: 25 },
        { date: '2026-04-06', count: 18 },
      ],
    ]);
    const module = await Test.createTestingModule({
      providers: [
        ReportsService,
        { provide: DRIZZLE, useValue: db },
      ],
    }).compile();
    service = module.get(ReportsService);

    const result = await service.getOccupancyTrend('prop-001', '2026-04-04', '2026-04-06');
    expect(result.period.start).toBe('2026-04-04');
    expect(result.period.end).toBe('2026-04-06');
    expect(result.daily).toHaveLength(3);
    expect(result.daily[0]!.date).toBe('2026-04-04');
    expect(result.daily[0]!.roomsSold).toBe(20);
    expect(result.daily[0]!.revenue).toBe(3000);
    expect(result.summary.totalRoomNights).toBe(63); // 20+25+18
    expect(result.summary.totalRevenue).toBe(9000);
  });

  it('should calculate period summary averages for trend', async () => {
    const db = createMockDb([
      [{ totalRooms: 100 }],
      [],
      [
        { date: '2026-04-04', revenue: '5000.00' },
        { date: '2026-04-05', revenue: '5000.00' },
      ],
      [
        { date: '2026-04-04', count: 50 },
        { date: '2026-04-05', count: 50 },
      ],
    ]);
    const module = await Test.createTestingModule({
      providers: [
        ReportsService,
        { provide: DRIZZLE, useValue: db },
      ],
    }).compile();
    service = module.get(ReportsService);

    const result = await service.getOccupancyTrend('prop-001', '2026-04-04', '2026-04-05');
    expect(result.daily).toHaveLength(2);
    // Each day: 50 rooms / 100 available = 0.5 occupancy, ADR = 5000/50 = 100, RevPAR = 100*0.5 = 50
    expect(result.summary.avgOccupancy).toBeCloseTo(0.5, 2);
    expect(result.summary.avgAdr).toBe(100);
    expect(result.summary.avgRevpar).toBe(50);
    expect(result.summary.totalRevenue).toBe(10000);
    expect(result.summary.totalRoomNights).toBe(100);
  });

  // --- Booking Pace ---

  it('should return rooms on books and new bookings per day', async () => {
    const db = createMockDb([
      // daily on-books (generate_series join)
      [
        { date: '2026-04-04', count: 42 },
        { date: '2026-04-05', count: 45 },
        { date: '2026-04-06', count: 40 },
      ],
      // daily new bookings
      [
        { date: '2026-04-04', count: 3 },
        { date: '2026-04-05', count: 5 },
        { date: '2026-04-06', count: 2 },
      ],
    ]);
    const module = await Test.createTestingModule({
      providers: [
        ReportsService,
        { provide: DRIZZLE, useValue: db },
      ],
    }).compile();
    service = module.get(ReportsService);

    const result = await service.getBookingPace('prop-001', '2026-04-04', '2026-04-06');
    expect(result.period.start).toBe('2026-04-04');
    expect(result.period.end).toBe('2026-04-06');
    expect(result.daily).toHaveLength(3);
    expect(result.daily[0]).toEqual({
      date: '2026-04-04',
      roomsOnBooks: 42,
      newBookings: 3,
    });
    expect(result.daily[1]!.newBookings).toBe(5);
    expect(result.summary.totalNewBookings).toBe(10);
    expect(result.summary.avgRoomsOnBooks).toBeCloseTo(42.33, 1);
  });

  it('should default new bookings to zero when none created that day', async () => {
    const db = createMockDb([
      [{ date: '2026-04-06', count: 30 }],
      [],
    ]);
    const module = await Test.createTestingModule({
      providers: [
        ReportsService,
        { provide: DRIZZLE, useValue: db },
      ],
    }).compile();
    service = module.get(ReportsService);

    const result = await service.getBookingPace('prop-001', '2026-04-06', '2026-04-06');
    expect(result.daily[0]!.roomsOnBooks).toBe(30);
    expect(result.daily[0]!.newBookings).toBe(0);
    expect(result.summary.totalNewBookings).toBe(0);
  });
});
