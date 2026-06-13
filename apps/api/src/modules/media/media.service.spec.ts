import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { MediaService } from './media.service';

/**
 * Chainable Drizzle mock. Terminal results are configurable per test:
 *  - state.select   → resolved by .limit() / .orderBy()
 *  - state.returning → resolved by .returning()
 *  - awaiting a chain (terminal .where()/.values()) resolves to undefined
 */
function createMockDb() {
  const state: { select: any[]; returning: any[] } = { select: [], returning: [] };
  const result: any = {
    limit: vi.fn(() => Promise.resolve(state.select)),
    orderBy: vi.fn(() => Promise.resolve(state.select)),
    returning: vi.fn(() => Promise.resolve(state.returning)),
    then: (res: any, rej: any) => Promise.resolve(undefined).then(res, rej),
  };
  const chain: any = {
    from: vi.fn(() => chain),
    where: vi.fn(() => result),
    set: vi.fn(() => chain),
    values: vi.fn(() => result),
  };
  const db: any = {
    select: vi.fn(() => chain),
    insert: vi.fn(() => chain),
    update: vi.fn(() => chain),
    delete: vi.fn(() => chain),
    transaction: vi.fn((cb: any) => cb(db)),
  };
  return { db, chain, state };
}

const PROP = '11111111-1111-1111-1111-111111111111';
const OWNER = '22222222-2222-2222-2222-222222222222';

describe('MediaService', () => {
  let mock: ReturnType<typeof createMockDb>;
  let storage: any;
  let service: MediaService;

  beforeEach(() => {
    mock = createMockDb();
    storage = { configured: true, put: vi.fn(), delete: vi.fn().mockResolvedValue(undefined) };
    service = new MediaService(mock.db, storage);
  });

  it('getConfig reflects storage availability', () => {
    expect(service.getConfig()).toEqual({ uploadEnabled: true });
  });

  it('rejects create when the room_type owner is not at the property', async () => {
    mock.state.select = []; // assertOwnerAtProperty finds nothing
    await expect(
      service.create({ propertyId: PROP, ownerType: 'room_type', ownerId: OWNER, url: 'https://x/y.jpg' } as any),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects property-owned media when ownerId !== propertyId', async () => {
    await expect(
      service.create({ propertyId: PROP, ownerType: 'property', ownerId: OWNER, url: 'https://x/y.jpg' } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('creates media and writes an audit log when the owner exists', async () => {
    mock.state.select = [{ id: OWNER }];
    mock.state.returning = [{ id: 'media-1', ownerType: 'room_type' }];
    const row = await service.create({
      propertyId: PROP,
      ownerType: 'room_type',
      ownerId: OWNER,
      url: 'https://x/y.jpg',
    } as any);
    expect(row).toEqual({ id: 'media-1', ownerType: 'room_type' });
    expect(mock.db.transaction).toHaveBeenCalled();
    expect(mock.db.insert).toHaveBeenCalled();
  });

  it('deletes the stored object when storageKey is present', async () => {
    mock.state.select = [{ id: 'media-1', storageKey: 'properties/p/media/abc.jpg', ownerType: 'room' }];
    await service.delete('media-1', PROP);
    expect(storage.delete).toHaveBeenCalledWith('properties/p/media/abc.jpg');
    expect(mock.db.delete).toHaveBeenCalled();
  });

  it('does not call storage.delete when there is no storageKey (URL media)', async () => {
    mock.state.select = [{ id: 'media-1', storageKey: null, ownerType: 'room' }];
    await service.delete('media-1', PROP);
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it('setPrimary clears prior primary then promotes the target (transactional)', async () => {
    mock.state.select = [{ id: 'media-1', ownerType: 'room_type', ownerId: OWNER }];
    mock.state.returning = [{ id: 'media-1', isPrimary: true }];
    const row = await service.setPrimary('media-1', PROP);
    expect(row).toEqual({ id: 'media-1', isPrimary: true });
    expect(mock.db.transaction).toHaveBeenCalled();
    // clearPrimary + promote = two update() calls
    expect(mock.db.update).toHaveBeenCalledTimes(2);
  });

  it('throws when the target media is not at the property', async () => {
    mock.state.select = [];
    await expect(service.setPrimary('media-1', PROP)).rejects.toBeInstanceOf(NotFoundException);
  });
});
