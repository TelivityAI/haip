import { describe, it, expect } from 'vitest';
import { resolveDashboardPersona } from './dashboard-persona';

describe('resolveDashboardPersona', () => {
  it('returns manager when auth is disabled', () => {
    expect(resolveDashboardPersona(['housekeeping.read'], false)).toBe('manager');
  });

  it('returns ops when no permissions', () => {
    expect(resolveDashboardPersona([], true)).toBe('ops');
  });

  it('maps front desk without reports to front_office', () => {
    expect(
      resolveDashboardPersona(['dashboard.view', 'frontdesk.access', 'reservations.read'], true),
    ).toBe('front_office');
  });

  it('maps housekeeping without reports to housekeeping', () => {
    expect(
      resolveDashboardPersona(['dashboard.view', 'housekeeping.read', 'rooms.read'], true),
    ).toBe('housekeeping');
  });

  it('maps revenue manager to revenue', () => {
    expect(
      resolveDashboardPersona(['dashboard.view', 'reports.view', 'revenue.manage', 'channels.manage'], true),
    ).toBe('revenue');
  });

  it('maps accounting to accounting', () => {
    expect(
      resolveDashboardPersona(
        ['dashboard.view', 'reports.view', 'accounting.view', 'nightaudit.run'],
        true,
      ),
    ).toBe('accounting');
  });

  it('maps GM/admin (broad) to manager', () => {
    expect(
      resolveDashboardPersona(
        ['reports.view', 'revenue.manage', 'accounting.view', 'frontdesk.access'],
        true,
      ),
    ).toBe('manager');
  });

  it('maps readonly reports.view to manager', () => {
    expect(resolveDashboardPersona(['dashboard.view', 'reports.view', 'reservations.read'], true)).toBe(
      'manager',
    );
  });
});
