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

  it('defines defaults for all six system roles', () => {
    expect(SYSTEM_ROLE_KEYS.sort()).toEqual(
      ['admin', 'front_desk', 'housekeeping', 'housekeeping_manager', 'night_auditor', 'readonly'].sort(),
    );
  });

  it('every navKey-bearing permission has a unique route', () => {
    const navKeys = PERMISSIONS.filter((p) => p.navKey).map((p) => p.navKey);
    expect(new Set(navKeys).size).toBe(navKeys.length);
  });
});
