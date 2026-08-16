/**
 * Resolve which home dashboard layout to show from effective property permissions.
 * Prefer permission sets over Keycloak realm role names so custom roles still map cleanly.
 */
export type DashboardPersona =
  | 'manager'
  | 'revenue'
  | 'accounting'
  | 'front_office'
  | 'housekeeping'
  | 'ops';

export function resolveDashboardPersona(
  permissions: string[],
  authEnabled: boolean,
): DashboardPersona {
  // Demo / auth-off: show the full manager flash report.
  if (!authEnabled) return 'manager';
  if (!permissions.length) return 'ops';

  const has = (key: string) => permissions.includes(key);

  // GM / admin: broad finance + revenue + ops.
  if (has('reports.view') && has('revenue.manage') && has('accounting.view')) {
    return 'manager';
  }
  if (has('revenue.manage') && has('reports.view')) return 'revenue';
  if ((has('accounting.view') || has('nightaudit.run')) && has('reports.view')) {
    return 'accounting';
  }
  if (has('reports.view')) return 'manager';

  if (has('housekeeping.read') && !has('frontdesk.access')) return 'housekeeping';
  if (has('frontdesk.access')) return 'front_office';
  if (has('housekeeping.read')) return 'housekeeping';

  return 'ops';
}

export function personaHeadlineKey(persona: DashboardPersona): string {
  switch (persona) {
    case 'manager':
      return 'dashboard.persona.manager';
    case 'revenue':
      return 'dashboard.persona.revenue';
    case 'accounting':
      return 'dashboard.persona.accounting';
    case 'front_office':
      return 'dashboard.persona.frontOffice';
    case 'housekeeping':
      return 'dashboard.persona.housekeeping';
    default:
      return 'dashboard.persona.ops';
  }
}

export function personaSubtitleKey(persona: DashboardPersona): string {
  switch (persona) {
    case 'manager':
      return 'dashboard.persona.managerHint';
    case 'revenue':
      return 'dashboard.persona.revenueHint';
    case 'accounting':
      return 'dashboard.persona.accountingHint';
    case 'front_office':
      return 'dashboard.persona.frontOfficeHint';
    case 'housekeeping':
      return 'dashboard.persona.housekeepingHint';
    default:
      return 'dashboard.persona.opsHint';
  }
}
