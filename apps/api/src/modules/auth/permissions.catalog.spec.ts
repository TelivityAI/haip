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

  // Folio / cashier / house-account / accounting used to list `reservations`
  // on every write route — that split was never real there. PaymentController
  // already included reservations (and excluded night_auditor); payments.refund
  // keeps refunds with FO / reservations / accounting only.
  it('reservations can book and post folios/cashier -- matches what the old realm-role gate already granted', () => {
    expect(ROLE_DEFAULT_PERMISSIONS.reservations).toContain('reservations.write');
    expect(ROLE_DEFAULT_PERMISSIONS.reservations).toContain('folios.read');
    expect(ROLE_DEFAULT_PERMISSIONS.reservations).toContain('folios.manage');
    expect(ROLE_DEFAULT_PERMISSIONS.reservations).toContain('cashier.access');
    expect(ROLE_DEFAULT_PERMISSIONS.reservations).toContain('houseaccounts.manage');
    expect(ROLE_DEFAULT_PERMISSIONS.reservations).toContain('accounting.manage');
    expect(ROLE_DEFAULT_PERMISSIONS.reservations).toContain('payments.refund');
  });

  it('night_auditor and accounting gained billing-write access; only accounting gets payments.refund', () => {
    for (const role of ['night_auditor', 'accounting']) {
      expect(ROLE_DEFAULT_PERMISSIONS[role], role).toContain('folios.manage');
      expect(ROLE_DEFAULT_PERMISSIONS[role], role).toContain('houseaccounts.manage');
      expect(ROLE_DEFAULT_PERMISSIONS[role], role).toContain('accounting.manage');
      expect(ROLE_DEFAULT_PERMISSIONS[role], role).toContain('communications.manage');
    }
    expect(ROLE_DEFAULT_PERMISSIONS.night_auditor).toContain('cashier.access');
    expect(ROLE_DEFAULT_PERMISSIONS.night_auditor).not.toContain('payments.refund');
    expect(ROLE_DEFAULT_PERMISSIONS.accounting).toContain('payments.refund');
  });

  it('front_desk gained cashier.access, accounting.manage, and payments.refund', () => {
    expect(ROLE_DEFAULT_PERMISSIONS.front_desk).toContain('cashier.access');
    expect(ROLE_DEFAULT_PERMISSIONS.front_desk).toContain('accounting.manage');
    expect(ROLE_DEFAULT_PERMISSIONS.front_desk).toContain('payments.refund');
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
