/**
 * Permission catalog — the single source of truth for authorization keys.
 *
 * Permissions are CODE-DEFINED (not a DB table) because each key maps 1:1 to an
 * API capability and/or a dashboard nav item that only exists in code. Roles and
 * their grants are DB-managed; a role may only be granted keys that exist here
 * (validated in RolesService). `navKey` (a dashboard route) ties a permission to
 * sidebar visibility so the UI and the API stay in lockstep.
 */
export interface PermissionDef {
  key: string;
  label: string;
  group: string;
  /** Dashboard route this permission gates in the sidebar, if any. */
  navKey?: string;
}

export const PERMISSIONS: readonly PermissionDef[] = [
  { key: 'dashboard.view', label: 'View dashboard', group: 'General', navKey: '/' },
  { key: 'frontdesk.access', label: 'Use front desk', group: 'Front Desk', navKey: '/front-desk' },
  { key: 'reservations.read', label: 'View reservations', group: 'Reservations', navKey: '/reservations' },
  { key: 'reservations.write', label: 'Create / modify reservations', group: 'Reservations' },
  { key: 'guests.read', label: 'View guests', group: 'Guests', navKey: '/guests' },
  { key: 'guests.write', label: 'Create / modify guests', group: 'Guests' },
  { key: 'rooms.read', label: 'View rooms', group: 'Rooms', navKey: '/rooms' },
  { key: 'rooms.write', label: 'Manage rooms / room types', group: 'Rooms' },
  { key: 'media.manage', label: 'Manage photos', group: 'Rooms' },
  { key: 'housekeeping.read', label: 'View housekeeping', group: 'Housekeeping', navKey: '/housekeeping' },
  { key: 'housekeeping.manage', label: 'Assign / inspect housekeeping', group: 'Housekeeping' },
  { key: 'folios.read', label: 'View folios & billing', group: 'Billing', navKey: '/folios' },
  { key: 'folios.manage', label: 'Post charges / payments', group: 'Billing' },
  { key: 'rateplans.read', label: 'View rate plans', group: 'Rate Plans', navKey: '/rate-plans' },
  { key: 'rateplans.manage', label: 'Manage rate plans', group: 'Rate Plans' },
  { key: 'revenue.manage', label: 'Revenue management', group: 'Revenue', navKey: '/revenue' },
  { key: 'nightaudit.run', label: 'Run night audit', group: 'Night Audit', navKey: '/night-audit' },
  { key: 'reports.view', label: 'View reports', group: 'Reports', navKey: '/reports' },
  { key: 'channels.manage', label: 'Manage channels', group: 'Channels', navKey: '/channels' },
  { key: 'communications.manage', label: 'Guest communications', group: 'Communications', navKey: '/communications' },
  { key: 'reviews.manage', label: 'Manage reviews', group: 'Reviews', navKey: '/reviews' },
  { key: 'settings.manage', label: 'Manage property settings', group: 'Settings', navKey: '/settings' },
  { key: 'admin.users.manage', label: 'Manage users', group: 'Administration', navKey: '/admin/users' },
  { key: 'admin.roles.manage', label: 'Manage roles & permissions', group: 'Administration' },
] as const;

export const PERMISSION_KEYS: readonly string[] = PERMISSIONS.map((p) => p.key);
const PERMISSION_KEY_SET = new Set(PERMISSION_KEYS);

export function isPermissionKey(key: string): boolean {
  return PERMISSION_KEY_SET.has(key);
}

/** Every permission key — used for the `admin` superuser role. */
export const ALL_PERMISSIONS: readonly string[] = PERMISSION_KEYS;

/**
 * Default grants for the six built-in (system) roles. These mirror the realm
 * roles Keycloak ships (keycloak/haip-realm.json) and the prior hardcoded
 * sidebar gating, so behavior is unchanged when auth is enabled.
 */
export const ROLE_DEFAULT_PERMISSIONS: Record<string, readonly string[]> = {
  admin: ALL_PERMISSIONS,
  front_desk: [
    'dashboard.view',
    'frontdesk.access',
    'reservations.read',
    'reservations.write',
    'guests.read',
    'guests.write',
    'rooms.read',
    'media.manage',
    'folios.read',
    'folios.manage',
    'rateplans.read',
    'communications.manage',
    'reviews.manage',
  ],
  housekeeping: ['dashboard.view', 'rooms.read', 'housekeeping.read'],
  housekeeping_manager: [
    'dashboard.view',
    'rooms.read',
    'rooms.write',
    'housekeeping.read',
    'housekeeping.manage',
  ],
  night_auditor: [
    'dashboard.view',
    'reservations.read',
    'folios.read',
    'nightaudit.run',
    'reports.view',
  ],
  readonly: [
    'dashboard.view',
    'reservations.read',
    'guests.read',
    'rooms.read',
    'folios.read',
    'rateplans.read',
    'reports.view',
  ],
};

/** Friendly display names for the system roles. */
export const SYSTEM_ROLE_LABELS: Record<string, string> = {
  admin: 'Administrator',
  front_desk: 'Front Desk',
  housekeeping: 'Housekeeping',
  housekeeping_manager: 'Housekeeping Manager',
  night_auditor: 'Night Auditor',
  readonly: 'Read Only',
};

export const SYSTEM_ROLE_KEYS = Object.keys(ROLE_DEFAULT_PERMISSIONS);
