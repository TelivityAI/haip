import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SearchService } from './search.service';

describe('SearchService', () => {
  let service: SearchService;
  let db: any;

  beforeEach(() => {
    db = {
      select: vi.fn(),
    };
    service = new SearchService(db);
  });

  it('returns empty for blank query types default', async () => {
    const chain = {
      from: vi.fn().mockReturnThis(),
      innerJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    };
    db.select.mockReturnValue(chain);

    const results = await service.search('prop-1', 'smith');
    expect(results).toEqual([]);
    expect(db.select).toHaveBeenCalled();
  });

  it('fans out portfolio search across property ids', async () => {
    const spy = vi.spyOn(service, 'search').mockResolvedValue([
      {
        type: 'guest',
        id: 'g1',
        propertyId: 'p1',
        title: 'Jane Smith',
        href: '/guests/g1',
      },
    ]);

    const results = await service.searchPortfolio(['p1', 'p2'], 'smith');
    expect(spy).toHaveBeenCalledTimes(2);
    expect(results).toHaveLength(2);
  });
});
