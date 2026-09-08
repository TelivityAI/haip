/**
 * Permission catalog — re-exports the shared source of truth and keeps Nest
 * `@Roles()` allow-list helpers that only the API uses.
 *
 * Grant data lives in `@telivityhaip/shared` so `packages/database` seed and the
 * API cannot drift.
 */
export {
  type PermissionDef,
  PERMISSIONS,
  PERMISSION_KEYS,
  ALL_PERMISSIONS,
  ROLE_DEFAULT_PERMISSIONS,
  SYSTEM_ROLE_LABELS,
  SYSTEM_ROLE_KEYS,
  isPermissionKey,
} from '@telivityhaip/shared';

/**
 * Shared @Roles() allow-lists so controllers stay consistent.
 * OWNER stays property-owner only (users, credentials, destructive settings).
 */
export const ROLE_SETS = {
  OWNER: ['admin'] as const,
  MANAGEMENT: ['admin', 'general_manager'] as const,
  FRONT_OFFICE: ['admin', 'general_manager', 'front_desk', 'reservations'] as const,
  FRONT_OFFICE_AND_AUDIT: [
    'admin',
    'general_manager',
    'front_desk',
    'reservations',
    'night_auditor',
    'accounting',
  ] as const,
  REVENUE: ['admin', 'general_manager', 'revenue_manager'] as const,
  REVENUE_AND_FRONT: [
    'admin',
    'general_manager',
    'front_desk',
    'reservations',
    'revenue_manager',
  ] as const,
  ACCOUNTING: ['admin', 'general_manager', 'accounting', 'night_auditor'] as const,
  HOUSEKEEPING: ['admin', 'general_manager', 'housekeeping', 'housekeeping_manager'] as const,
  HOUSEKEEPING_LEAD: ['admin', 'general_manager', 'housekeeping_manager'] as const,
  ROOM_OPS: ['admin', 'general_manager', 'front_desk', 'housekeeping_manager'] as const,
  ROOM_STATUS: [
    'admin',
    'general_manager',
    'front_desk',
    'housekeeping',
    'housekeeping_manager',
  ] as const,
} as const;
