import { describe, it, expect } from 'vitest';
import {
  PERMISSIONS,
  PERMISSION_KEYS,
  ALL_PERMISSIONS,
  ROLE_DEFAULT_PERMISSIONS,
  SYSTEM_ROLE_KEYS,
  isPermissionKey,
} from './permissions.catalog';

describe('permissions catalog', () => {
  it('has unique permission keys', () => {
    expect(new Set(PERMISSION_KEYS).size).toBe(PERMISSION_KEYS.length);
  });

  it('ALL_PERMISSIONS equals the full key list', () => {
    expect([...ALL_PERMISSIONS].sort()).toEqual([...PERMISSION_KEYS].sort());
  });

  it('every role default references only catalog keys', () => {
    for (const [role, keys] of Object.entries(ROLE_DEFAULT_PERMISSIONS)) {
      for (const key of keys) {
        expect(isPermissionKey(key), `${role} references unknown permission ${key}`).toBe(true);
      }
    }
  });

  it('admin is granted every permission', () => {
    expect([...ROLE_DEFAULT_PERMISSIONS.admin].sort()).toEqual([...PERMISSION_KEYS].sort());
  });

  it('defines defaults for all system roles', () => {
    expect(SYSTEM_ROLE_KEYS.sort()).toEqual(
      [
        'accounting',
        'admin',
        'front_desk',
        'general_manager',
        'housekeeping',
        'housekeeping_manager',
        'integration_inventory',
        'integration_reservations',
        'night_auditor',
        'readonly',
        'reservations',
        'revenue_manager',
      ].sort(),
    );
  });

  it('general_manager excludes owner-only admin permissions', () => {
    expect(ROLE_DEFAULT_PERMISSIONS.general_manager).not.toContain('admin.users.manage');
    expect(ROLE_DEFAULT_PERMISSIONS.general_manager).not.toContain('admin.roles.manage');
    expect(ROLE_DEFAULT_PERMISSIONS.general_manager).toContain('settings.manage');
    expect(ROLE_DEFAULT_PERMISSIONS.general_manager).toContain('revenue.manage');
  });

  it('reservations can book but not post folios or run cashier', () => {
    expect(ROLE_DEFAULT_PERMISSIONS.reservations).toContain('reservations.write');
    expect(ROLE_DEFAULT_PERMISSIONS.reservations).toContain('folios.read');
    expect(ROLE_DEFAULT_PERMISSIONS.reservations).not.toContain('folios.manage');
    expect(ROLE_DEFAULT_PERMISSIONS.reservations).not.toContain('cashier.access');
  });

  it('revenue_manager cannot view folios (nav and list API gated)', () => {
    expect(ROLE_DEFAULT_PERMISSIONS.revenue_manager).not.toContain('folios.read');
  });

  it('accounting cannot view rate plans (sidebar hides /rate-plans)', () => {
    expect(ROLE_DEFAULT_PERMISSIONS.accounting).not.toContain('rateplans.read');
  });

  it('every navKey-bearing permission has a unique route', () => {
    const navKeys = PERMISSIONS.filter((p) => p.navKey).map((p) => p.navKey);
    expect(new Set(navKeys).size).toBe(navKeys.length);
  });
});
