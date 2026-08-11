import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MigrationLegacyIdMapService } from './migration-legacy-id-map.service';

describe('MigrationLegacyIdMapService', () => {
  let db: any;
  let svc: MigrationLegacyIdMapService;

  beforeEach(() => {
    const rows: any[] = [];
    db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => Promise.resolve(rows)),
        })),
      })),
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          onConflictDoNothing: vi.fn(() => Promise.resolve()),
        })),
      })),
      _rows: rows,
    };
    svc = new MigrationLegacyIdMapService(db);
  });

  it('returns null when no mapping exists', async () => {
    const result = await svc.lookup('prop-1', 'proj-1', 'guests', 'LEG-1');
    expect(result).toBeNull();
  });

  it('returns haip id when mapping exists', async () => {
    db._rows.push({ haipId: 'uuid-1' });
    const result = await svc.lookup('prop-1', 'proj-1', 'guests', 'LEG-1');
    expect(result).toBe('uuid-1');
  });

  it('records a mapping idempotently', async () => {
    await svc.record('prop-1', 'proj-1', 'guests', 'LEG-1', 'uuid-1');
    expect(db.insert).toHaveBeenCalled();
  });
});
