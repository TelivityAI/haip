import { describe, it, expect, vi } from 'vitest';
import { TurnawaysService } from './turnaways.service';

function selectQueue(...results: any[][]) {
  const where = vi.fn();
  for (const result of results) {
    where.mockResolvedValueOnce(result);
  }
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn().mockImplementation(() => where()),
          then: (resolve: (value: any[]) => void) => resolve(where()),
        })),
      })),
    })),
    where,
  };
}

describe('TurnawaysService', () => {
  it('creates a turnaway pinned to the requested propertyId', async () => {
    const db = {
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          returning: vi.fn().mockResolvedValue([{ id: 'ta-1', propertyId: 'prop-1', type: 'denial' }]),
        })),
      })),
    };
    const service = new TurnawaysService(db as any);

    const result = await service.create('prop-1', {
      arrivalDate: '2026-08-10',
      type: 'denial',
      nights: 2,
      roomsRequested: 1,
      adults: 2,
      children: 0,
      comment: 'Sold out',
    });

    expect(result.propertyId).toBe('prop-1');
    const values = db.insert.mock.results[0]?.value.values.mock.calls[0]?.[0];
    expect(values?.propertyId).toBe('prop-1');
    expect(values?.type).toBe('denial');
  });

  it('summarizes counts by type and reason', async () => {
    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn().mockResolvedValue([
            {
              id: 'reason-1',
              code: 'FULLY_BOOKED',
              description: 'Sold out',
              type: 'denial',
            },
          ]),
        })),
      })),
    };
    const service = new TurnawaysService(db as any);
    vi.spyOn(service, 'list').mockResolvedValue([
      { id: 't1', type: 'denial', reasonCodeId: 'reason-1' },
      { id: 't2', type: 'denial', reasonCodeId: 'reason-1' },
      { id: 't3', type: 'regret', reasonCodeId: null },
    ] as any);

    const result = await service.summary({
      propertyId: 'prop-1',
      from: '2026-08-01',
      to: '2026-08-31',
    });

    expect(result.total).toBe(3);
    expect(result.byType).toMatchObject({ denial: 2, regret: 1 });
    expect(result.byReason).toContainEqual(
      expect.objectContaining({
        reasonCodeId: 'reason-1',
        code: 'FULLY_BOOKED',
        count: 2,
      }),
    );
  });
});
