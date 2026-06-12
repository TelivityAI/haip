import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { RolesService } from './roles.service';

function createMockDb() {
  const state: { select: any[]; where: any[]; returning: any[] } = { select: [], where: [], returning: [] };
  const result: any = {
    limit: vi.fn(() => Promise.resolve(state.select)),
    orderBy: vi.fn(() => Promise.resolve(state.select)),
    returning: vi.fn(() => Promise.resolve(state.returning)),
    then: (res: any, rej: any) => Promise.resolve(state.where).then(res, rej),
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
  return { db, state };
}

const PROP = '11111111-1111-1111-1111-111111111111';

describe('RolesService', () => {
  let mock: ReturnType<typeof createMockDb>;
  let service: RolesService;

  beforeEach(() => {
    mock = createMockDb();
    service = new RolesService(mock.db);
  });

  it('rejects creating a role with a duplicate key', async () => {
    mock.state.select = [{ id: 'existing' }];
    await expect(
      service.create({ propertyId: PROP, key: 'spa', name: 'Spa' } as any),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('update throws NotFound for a missing/non-custom role', async () => {
    mock.state.select = []; // getCustomRole finds nothing (system roles have null propertyId)
    await expect(service.update('r1', PROP, { name: 'X' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects modifying a system role', async () => {
    mock.state.select = [{ id: 'r1', propertyId: PROP, isSystem: true }];
    await expect(service.update('r1', PROP, { name: 'X' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('setPermissions rejects unknown permission keys', async () => {
    mock.state.select = [{ id: 'r1', propertyId: PROP, isSystem: false }];
    await expect(
      service.setPermissions('r1', PROP, ['rooms.read', 'not.a.real.permission']),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('setPermissions accepts valid catalog keys and replaces grants', async () => {
    mock.state.select = [{ id: 'r1', propertyId: PROP, isSystem: false }];
    const res = await service.setPermissions('r1', PROP, ['rooms.read', 'rooms.read', 'media.manage']);
    expect(res).toEqual({ roleId: 'r1', permissions: ['rooms.read', 'media.manage'] });
    expect(mock.db.transaction).toHaveBeenCalled();
  });

  it('delete rejects a role that is still assigned to users', async () => {
    mock.state.select = [{ id: 'r1', propertyId: PROP, isSystem: false }]; // getCustomRole + assigned check
    await expect(service.delete('r1', PROP)).rejects.toBeInstanceOf(ConflictException);
  });
});
