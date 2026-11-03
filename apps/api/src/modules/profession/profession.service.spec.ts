import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ProfessionService } from './profession.service';

describe('ProfessionService', () => {
  let service: ProfessionService;
  let mockDb: any;

  beforeEach(() => {
    mockDb = {
      select: vi.fn(),
      insert: vi.fn(),
    };
    service = new ProfessionService(mockDb);
  });

  it('searches professions with query filter and limit', async () => {
    const mockRows = [
      { id: '1', name: 'Software Engineer', code: '212405', countryCode: 'BR' },
    ];

    const chain: any = {
      $dynamic: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue(mockRows),
    };

    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue(chain),
    });

    const result = await service.search({ q: 'software', limit: 10 });
    expect(result.data).toEqual(mockRows);
    expect(result.count).toBe(1);
  });

  it('finds existing profession without inserting duplicate', async () => {
    const existing = { id: 'p-1', name: 'Médico', code: '225105' };

    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([existing]),
        }),
      }),
    });

    const result = await service.findOrCreate({ name: 'Médico' });
    expect(result).toEqual(existing);
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('creates new profession when it does not exist', async () => {
    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    });

    const created = { id: 'p-new', name: 'Engenheiro de IA', code: null, countryCode: 'BR', metadata: { cbo: 'custom' } };
    mockDb.insert.mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([created]),
      }),
    });

    const result = await service.findOrCreate({
      name: 'Engenheiro de IA',
      countryCode: 'BR',
      metadata: { cbo: 'custom' },
    });
    expect(result).toEqual(created);
    expect(mockDb.insert).toHaveBeenCalled();
  });
});
