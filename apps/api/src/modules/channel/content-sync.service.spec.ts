import { describe, it, expect, vi, beforeEach } from 'vitest';
import { properties, roomTypes, contentSyncLogs } from '@telivityhaip/database';
import { ContentSyncService } from './content-sync.service';

/** Mock db keyed by table identity so property and room-type queries differ. */
function createMockDb() {
  const results = new Map<unknown, any[]>();
  const inserted: Array<{ table: unknown; values: any }> = [];
  let currentTable: unknown;
  const selectChain = {
    from: (t: unknown) => {
      currentTable = t;
      return {
        where: () => Promise.resolve(results.get(currentTable) ?? []),
      };
    },
  };
  const db: any = {
    select: () => selectChain,
    insert: (t: unknown) => ({
      values: (v: any) => {
        inserted.push({ table: t, values: v });
        return Promise.resolve();
      },
    }),
  };
  return { db, results, inserted };
}

const PROP = 'p1';
const property = { id: PROP, name: 'Grand', description: 'd', addressLine1: 'a', city: 'c', countryCode: 'US', starRating: 5 };
const rt = { id: 'rt1', name: 'Standard', description: 'sd', maxOccupancy: 2, bedType: 'king', amenities: ['wifi'] };
const conn = { id: 'cc1', adapterType: 'mock', config: {}, roomTypeMapping: [{ roomTypeId: 'rt1', channelRoomCode: 'EXP_STD' }] };

function setup(overrides: { roomTypeRows?: any[]; propertyRows?: any[] } = {}) {
  const mock = createMockDb();
  mock.results.set(properties, overrides.propertyRows ?? [property]);
  mock.results.set(roomTypes, overrides.roomTypeRows ?? [rt]);

  const adapter = { pushContent: vi.fn().mockResolvedValue({ success: true, itemsSynced: 2, errors: [] }) };
  const adapterFactory: any = { getAdapter: vi.fn().mockReturnValue(adapter) };
  const channelService: any = {
    getActiveConnections: vi.fn().mockResolvedValue([conn]),
    findById: vi.fn().mockResolvedValue(conn),
    updateSyncStatus: vi.fn().mockResolvedValue(undefined),
  };
  const mediaService: any = {
    findByOwner: vi.fn(async (_pid: string, ownerType: string) =>
      ownerType === 'property'
        ? [{ url: 'https://x/hero.jpg', category: 'hero', caption: 'H', isPrimary: true, sortOrder: 0 }]
        : [{ url: 'https://x/std.jpg', category: 'room', caption: null, isPrimary: true, sortOrder: 0 }],
    ),
  };
  const service = new ContentSyncService(mock.db, adapterFactory, channelService, mediaService);
  return { service, mock, adapter, adapterFactory, channelService, mediaService };
}

describe('ContentSyncService', () => {
  let s: ReturnType<typeof setup>;
  beforeEach(() => { s = setup(); });

  it('pushes assembled content and writes a content_push log', async () => {
    const results = await s.service.pushContent(PROP);
    expect(results).toHaveLength(1);

    const params = s.adapter.pushContent.mock.calls[0]![0];
    expect(params.property.name).toBe('Grand');
    expect(params.property.images).toHaveLength(1);
    expect(params.roomTypes).toHaveLength(1);
    expect(params.roomTypes[0].channelRoomCode).toBe('EXP_STD');
    expect(params.roomTypes[0].images[0].url).toBe('https://x/std.jpg');

    const log = s.mock.inserted.find((r) => r.table === contentSyncLogs);
    expect(log?.values.action).toBe('content_push');
    expect(log?.values.status).toBe('success');
    expect(s.channelService.updateSyncStatus).toHaveBeenCalledWith('cc1', 'success', undefined);
  });

  it('skips room-type mappings whose room type is not at the property', async () => {
    s = setup({ roomTypeRows: [] }); // room type lookup returns nothing
    await s.service.pushContent(PROP);
    const params = s.adapter.pushContent.mock.calls[0]![0];
    expect(params.roomTypes).toHaveLength(0);
  });

  it('returns early (no push) when the property does not exist', async () => {
    s = setup({ propertyRows: [] });
    const results = await s.service.pushContent(PROP);
    expect(results).toEqual([]);
    expect(s.adapter.pushContent).not.toHaveBeenCalled();
  });

  it('handleContentUpdated triggers a push (fire-and-forget)', async () => {
    await s.service.handleContentUpdated({ propertyId: PROP } as any);
    expect(s.adapter.pushContent).toHaveBeenCalled();
  });

  it('handleContentUpdated swallows errors', async () => {
    s.channelService.getActiveConnections.mockRejectedValue(new Error('boom'));
    await expect(s.service.handleContentUpdated({ propertyId: PROP } as any)).resolves.toBeUndefined();
  });
});
