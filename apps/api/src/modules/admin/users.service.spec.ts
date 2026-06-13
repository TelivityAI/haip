import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { UsersService } from './users.service';

/**
 * Chainable Drizzle mock. Terminal results are configurable:
 *  - state.select    → resolved by .limit()
 *  - state.where     → resolved by awaiting a chain (terminal .where()/.values())
 *  - state.returning → resolved by .returning()
 */
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
    innerJoin: vi.fn(() => chain),
    where: vi.fn(() => result),
    set: vi.fn(() => chain),
    values: vi.fn(() => result),
  };
  const db: any = {
    select: vi.fn(() => chain),
    selectDistinct: vi.fn(() => chain),
    insert: vi.fn(() => chain),
    update: vi.fn(() => chain),
    delete: vi.fn(() => chain),
    transaction: vi.fn((cb: any) => cb(db)),
  };
  return { db, state };
}

const PROP = '11111111-1111-1111-1111-111111111111';

describe('UsersService', () => {
  let mock: ReturnType<typeof createMockDb>;
  let permissions: any;
  let service: UsersService;

  beforeEach(() => {
    mock = createMockDb();
    permissions = { getEffectivePermissions: vi.fn().mockResolvedValue([]) };
    service = new UsersService(mock.db, permissions);
  });

  it('rejects creating a user with a duplicate email', async () => {
    mock.state.select = [{ id: 'existing' }]; // dupe lookup (.limit)
    await expect(
      service.create({ propertyId: PROP, email: 'dupe@x.com', name: 'Dupe' } as any),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('creates a user and writes an audit log', async () => {
    mock.state.select = []; // no dupe
    mock.state.returning = [{ id: 'u1', email: 'new@x.com' }];
    const user = await service.create({ propertyId: PROP, email: 'new@x.com', name: 'New' } as any);
    expect(user).toEqual({ id: 'u1', email: 'new@x.com' });
    expect(mock.db.transaction).toHaveBeenCalled();
  });

  it('update throws NotFound when the user is not at the property', async () => {
    mock.state.select = []; // getOwned finds nothing
    await expect(service.update('u1', PROP, { name: 'X' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('disable soft-disables an existing user', async () => {
    mock.state.select = [{ id: 'u1', propertyId: PROP }];
    const res = await service.disable('u1', PROP);
    expect(res).toEqual({ disabled: true });
    expect(mock.db.update).toHaveBeenCalled();
  });

  it('assignRoles rejects roles that do not exist at the property', async () => {
    mock.state.select = [{ id: 'u1', propertyId: PROP }]; // getOwned ok
    mock.state.where = []; // assertRolesExist finds none
    await expect(
      service.assignRoles('u1', PROP, ['33333333-3333-3333-3333-333333333333']),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
