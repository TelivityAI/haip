import { describe, it, expect, vi } from 'vitest';
import { ReportsService } from './reports.service';

describe('ReportsService portfolio', () => {
  const service = new ReportsService(null as any);

  it('aggregates financial summary across properties', async () => {
    vi.spyOn(service, 'getFinancialSummary').mockImplementation(async (id: string) => ({
      date: '2026-07-08',
      kpis: {
        adr: 100,
        revpar: 50,
        occupancyRate: 0.5,
        totalRevenue: id === 'p1' ? 1000 : 2000,
        roomRevenue: id === 'p1' ? 800 : 1600,
      },
      revenueByType: {},
      paymentsByMethod: {},
      outstandingBalances: { totalFoliosOpen: 0, totalBalanceDue: 0 },
      auditStatus: { lastAuditDate: null, lastAuditStatus: null, errorsInLastAudit: 0 },
    }));

    vi.spyOn(service, 'getOccupancy').mockImplementation(async (id: string) => ({
      date: '2026-07-08',
      totalRooms: 100,
      availableRooms: 90,
      occupiedRooms: id === 'p1' ? 45 : 45,
      occupancyRate: 0.5,
      occupancyPercent: '50.0%',
      arrivals: 5,
      departures: 3,
      stayovers: 40,
      noShows: 0,
      cancellations: 0,
      outOfOrder: 5,
      outOfService: 5,
    }));

    const result = await service.getPortfolioFinancialSummary(['p1', 'p2'], '2026-07-08');

    expect(result.propertyCount).toBe(2);
    expect(result.kpis.totalRevenue).toBe(3000);
    expect(result.kpis.totalRoomsSold).toBe(90);
    expect(result.byProperty).toHaveLength(2);
  });

  it('aggregates occupancy across properties', async () => {
    vi.spyOn(service, 'getOccupancy')
      .mockResolvedValueOnce({
        date: '2026-07-08',
        totalRooms: 50,
        availableRooms: 45,
        occupiedRooms: 30,
        occupancyRate: 0.67,
        occupancyPercent: '67.0%',
        arrivals: 10,
        departures: 5,
        stayovers: 20,
        noShows: 0,
        cancellations: 0,
        outOfOrder: 3,
        outOfService: 2,
      })
      .mockResolvedValueOnce({
        date: '2026-07-08',
        totalRooms: 80,
        availableRooms: 70,
        occupiedRooms: 35,
        occupancyRate: 0.5,
        occupancyPercent: '50.0%',
        arrivals: 8,
        departures: 6,
        stayovers: 25,
        noShows: 0,
        cancellations: 0,
        outOfOrder: 5,
        outOfService: 5,
      });

    const result = await service.getPortfolioOccupancy(['p1', 'p2'], '2026-07-08');

    expect(result.totalRooms).toBe(130);
    expect(result.availableRooms).toBe(115);
    expect(result.occupiedRooms).toBe(65);
    expect(result.arrivals).toBe(18);
    expect(result.departures).toBe(11);
  });
});
