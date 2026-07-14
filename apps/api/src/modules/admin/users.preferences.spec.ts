import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UsersService } from './users.service';

describe('UsersService preferences', () => {
  let db: any;
  let service: UsersService;

  beforeEach(() => {
    db = {
      select: vi.fn(),
      update: vi.fn(),
    };
    service = new UsersService(db, { getEffectivePermissions: vi.fn() } as any);
  });

  it('returns preferences for a user', async () => {
    const chain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ preferences: { reportFavorites: ['occupancy'] } }]),
    };
    db.select.mockReturnValue(chain);
    await expect(service.getPreferences('u1')).resolves.toEqual({
      reportFavorites: ['occupancy'],
    });
  });

  it('merges preference updates', async () => {
    const selectChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ preferences: { reportFavorites: ['occupancy'] } }]),
    };
    db.select.mockReturnValue(selectChain);

    const returning = vi.fn().mockResolvedValue([
      { preferences: { reportFavorites: ['occupancy', 'financial-summary'] } },
    ]);
    const set = vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({ returning }),
    });
    db.update.mockReturnValue({ set });

    const result = await service.updatePreferences('u1', {
      reportFavorites: ['occupancy', 'financial-summary'],
    });
    expect(result.reportFavorites).toEqual(['occupancy', 'financial-summary']);
    expect(set).toHaveBeenCalled();
  });
});
