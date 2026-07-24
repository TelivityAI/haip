import { describe, expect, it, vi } from 'vitest';
import { AvailabilityService } from './availability.service';

function availabilityDb(stages: Array<{ rows: any[]; groupBy?: boolean; innerJoin?: boolean }>) {
  let index = 0;
  return {
    select: vi.fn(() => {
      const stage = stages[index++];
      if (!stage) throw new Error('Unexpected select call');
      const whereResult = stage.groupBy
        ? { groupBy: vi.fn().mockResolvedValue(stage.rows) }
        : Promise.resolve(stage.rows);
      const fromResult = stage.innerJoin
        ? { innerJoin: vi.fn(() => ({ where: vi.fn().mockResolvedValue(stage.rows) })) }
        : { where: vi.fn(() => whereResult) };
      return { from: vi.fn(() => fromResult) };
    }),
  };
}

describe('AvailabilityService', () => {
  it('reduces availability with active imported iCal blocks per distinct feed/date', async () => {
    const db = availabilityDb([
      { rows: [{ id: 'prop-1', overbookingPercentage: 0 }] },
      { rows: [{ id: 'rt-1', name: 'Standard', maxOccupancy: 2 }] },
      { rows: [{ roomTypeId: 'rt-1', arrivalDate: '2026-09-01', departureDate: '2026-09-02' }] },
      { rows: [{ roomTypeId: 'rt-1', count: 5 }], groupBy: true },
      {
        innerJoin: true,
        rows: [
          { roomTypeId: 'rt-1', feedId: 'feed-1', startDate: '2026-09-01', endDate: '2026-09-03' },
          { roomTypeId: 'rt-1', feedId: 'feed-1', startDate: '2026-09-01', endDate: '2026-09-02' },
          { roomTypeId: 'rt-1', feedId: 'feed-2', startDate: '2026-09-01', endDate: '2026-09-02' },
        ],
      },
    ]);
    const service = new AvailabilityService(db as any);

    const results = await service.searchAvailability('prop-1', '2026-09-01', '2026-09-02', 'rt-1');

    expect(results).toEqual([
      {
        roomTypeId: 'rt-1',
        roomTypeName: 'Standard',
        date: '2026-09-01',
        totalRooms: 5,
        sold: 3,
        available: 2,
        overbookingBuffer: 0,
      },
    ]);
  });
});
