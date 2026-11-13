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

  it('list collapses duplicate global system roles (20 -> 10) while keeping custom roles distinct', async () => {
    mock.state.select = [
      { id: 'ee000001-0000-4000-a000-000000000001', propertyId: null, key: 'admin', name: 'Administrator', isSystem: true },
      { id: 'boot-admin-uuid', propertyId: null, key: 'admin', name: 'Administrator', isSystem: true },
      { id: 'ee000001-0000-4000-a000-000000000002', propertyId: null, key: 'front_desk', name: 'Front Desk', isSystem: true },
      { id: 'boot-fd-uuid', propertyId: null, key: 'front_desk', name: 'Front Desk', isSystem: true },
      { id: 'custom-1', propertyId: PROP, key: 'spa_lead', name: 'Spa Lead', isSystem: false },
    ];
    mock.state.where = [
      { roleId: 'boot-admin-uuid', permissionKey: 'dashboard.view' },
      { roleId: 'boot-admin-uuid', permissionKey: 'admin.roles.manage' },
      { roleId: 'custom-1', permissionKey: 'guests.read' },
    ];

    const out = await service.list(PROP);
    expect(out).toHaveLength(3);
    const admin = out.find((r: any) => r.key === 'admin');
    const fd = out.find((r: any) => r.key === 'front_desk');
    const custom = out.find((r: any) => r.key === 'spa_lead');
    expect(admin.id).toBe('boot-admin-uuid');
    expect(admin.permissions).toEqual(['dashboard.view', 'admin.roles.manage']);
    expect(fd.id).toBe('ee000001-0000-4000-a000-000000000002');
    expect(custom.id).toBe('custom-1');
  });

  it('dedupeSystemRoles selects by each candidate’s own grants and never unions permissions across IDs', () => {
    // Unequal overlapping sets — richer own-grant set wins; returned perms are that ID only.
    const unequal = RolesService.dedupeSystemRoles([
      {
        id: 'ee000001-0000-4000-a000-000000000001',
        propertyId: null,
        key: 'admin',
        name: 'Administrator',
        isSystem: true,
        permissions: ['dashboard.view', 'guests.read'],
      },
      {
        id: 'boot-admin-rich',
        propertyId: null,
        key: 'admin',
        name: 'Administrator',
        isSystem: true,
        permissions: ['dashboard.view', 'guests.read', 'admin.roles.manage'],
      },
      {
        id: 'custom-1',
        propertyId: PROP,
        key: 'spa_lead',
        name: 'Spa Lead',
        isSystem: false,
        permissions: ['guests.read'],
      },
    ]);
    const admin = unequal.find((r) => r.key === 'admin')!;
    expect(admin.id).toBe('boot-admin-rich');
    expect(admin.permissions).toEqual([
      'dashboard.view',
      'guests.read',
      'admin.roles.manage',
    ]);
    expect(unequal.find((r) => r.id === 'custom-1')).toBeTruthy();

    // Equal-size different overlapping sets — prefer canonical ee000001-*; no union.
    const equalSize = RolesService.dedupeSystemRoles([
      {
        id: 'boot-fd',
        propertyId: null,
        key: 'front_desk',
        name: 'Front Desk',
        isSystem: true,
        permissions: ['dashboard.view', 'reservations.write'],
      },
      {
        id: 'ee000001-0000-4000-a000-000000000002',
        propertyId: null,
        key: 'front_desk',
        name: 'Front Desk',
        isSystem: true,
        permissions: ['dashboard.view', 'guests.read'],
      },
    ]);
    const fd = equalSize.find((r) => r.key === 'front_desk')!;
    expect(fd.id).toBe('ee000001-0000-4000-a000-000000000002');
    expect(fd.permissions).toEqual(['dashboard.view', 'guests.read']);
    expect(fd.permissions).not.toContain('reservations.write');

    // Returned permissions must match what assigning that role ID grants
    // (property-scoped role_permissions for that roleId only).
    const grantsByRoleId: Record<string, string[]> = {
      'boot-admin-rich': ['dashboard.view', 'guests.read', 'admin.roles.manage'],
      'ee000001-0000-4000-a000-000000000002': ['dashboard.view', 'guests.read'],
    };
    expect(grantsByRoleId[admin.id]).toEqual(admin.permissions);
    expect(grantsByRoleId[fd.id]).toEqual(fd.permissions);
  });

  it('list hydrates property-scoped grants per role id then dedupes without cross-ID permission bleed', async () => {
    mock.state.select = [
      {
        id: 'ee000001-0000-4000-a000-000000000001',
        propertyId: null,
        key: 'admin',
        name: 'Administrator',
        isSystem: true,
      },
      {
        id: 'boot-admin-uuid',
        propertyId: null,
        key: 'admin',
        name: 'Administrator',
        isSystem: true,
      },
      {
        id: 'custom-1',
        propertyId: PROP,
        key: 'spa_lead',
        name: 'Spa Lead',
        isSystem: false,
      },
    ];
    // Overlapping unequal grants at PROP — boot is richer; ee has a grant boot lacks.
    mock.state.where = [
      { roleId: 'ee000001-0000-4000-a000-000000000001', permissionKey: 'dashboard.view' },
      { roleId: 'ee000001-0000-4000-a000-000000000001', permissionKey: 'folios.read' },
      { roleId: 'boot-admin-uuid', permissionKey: 'dashboard.view' },
      { roleId: 'boot-admin-uuid', permissionKey: 'guests.read' },
      { roleId: 'boot-admin-uuid', permissionKey: 'admin.roles.manage' },
      { roleId: 'custom-1', permissionKey: 'guests.read' },
    ];

    const out = await service.list(PROP);
    const admin = out.find((r: any) => r.key === 'admin');
    expect(admin.id).toBe('boot-admin-uuid');
    expect(admin.permissions.sort()).toEqual(
      ['admin.roles.manage', 'dashboard.view', 'guests.read'].sort(),
    );
    // Must not include folios.read from the discarded ee000001 row.
    expect(admin.permissions).not.toContain('folios.read');
    expect(out.find((r: any) => r.id === 'custom-1')?.permissions).toEqual(['guests.read']);
  });
});
