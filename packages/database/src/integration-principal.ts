/**
 * Link a Keycloak service-account JWT subject to a local HAIP user + role grants.
 * Used by server-to-server integrations that call staff REST routes (@RequirePermissions).
 *
 * Permission keys mirror apps/api/src/modules/auth/permissions.catalog.ts — keep
 * INTEGRATION_PROFILES in sync when adding profiles.
 */
import { and, eq, isNull } from 'drizzle-orm';
import { properties, roles, rolePermissions, userRoles, users } from './schema/index.js';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type IntegrationProfile = 'inventory' | 'reservations' | 'custom';

export const INTEGRATION_PROFILES: Record<
  Exclude<IntegrationProfile, 'custom'>,
  { roleKey: string; name: string; permissions: readonly string[] }
> = {
  inventory: {
    roleKey: 'integration_inventory',
    name: 'Integration — Inventory',
    permissions: ['rooms.read', 'rooms.write', 'ops.manage'],
  },
  reservations: {
    roleKey: 'integration_reservations',
    name: 'Integration — Reservations',
    permissions: [
      'reservations.read',
      'reservations.write',
      'guests.read',
      'guests.write',
      'rooms.read',
    ],
  },
};

/** Keys accepted for --profile custom (subset of catalog; extend when needed). */
export const INTEGRATION_CUSTOM_PERMISSION_ALLOWLIST: readonly string[] = [
  ...INTEGRATION_PROFILES.inventory.permissions,
  ...INTEGRATION_PROFILES.reservations.permissions,
  'dashboard.view',
  'folios.read',
  'folios.manage',
  'rateplans.read',
  'rateplans.manage',
  'reports.view',
  'nightaudit.run',
];

export interface LinkIntegrationPrincipalInput {
  propertyId: string;
  keycloakSub: string;
  label: string;
  profile: IntegrationProfile;
  permissions?: string[];
}

export interface LinkIntegrationPrincipalResult {
  userId: string;
  roleId: string;
  roleKey: string;
  email: string;
  userCreated: boolean;
  roleCreated: boolean;
  assignmentCreated: boolean;
}

export function slugifyIntegrationLabel(label: string): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug || 'integration';
}

export function integrationPrincipalEmail(label: string): string {
  return `svc-${slugifyIntegrationLabel(label)}@integrations.local`;
}

export function isValidKeycloakSub(sub: string): boolean {
  return UUID_RE.test(sub);
}

function assertValidCustomPermissions(permissions: string[]): void {
  if (permissions.length === 0) {
    throw new Error('custom profile requires at least one permission (--permissions)');
  }
  const invalid = permissions.filter((k) => !INTEGRATION_CUSTOM_PERMISSION_ALLOWLIST.includes(k));
  if (invalid.length > 0) {
    throw new Error(`Unknown permission key(s): ${invalid.join(', ')}`);
  }
}

type Db = any;

export async function ensureSystemIntegrationRole(
  db: Db,
  propertyId: string,
  roleKey: string,
  name: string,
  permissions: readonly string[],
): Promise<{ roleId: string; created: boolean }> {
  const [existing] = await (db as any)
    .select()
    .from(roles)
    .where(and(eq(roles.key, roleKey), isNull(roles.propertyId)))
    .limit(1);

  let roleId: string;
  let created = false;

  if (existing) {
    roleId = existing.id;
  } else {
    const [row] = await (db as any)
      .insert(roles)
      .values({
        propertyId: null,
        key: roleKey,
        name,
        description: `Built-in ${name} role`,
        isSystem: true,
      })
      .returning();
    roleId = row.id;
    created = true;
  }

  for (const permissionKey of permissions) {
    const [grant] = await (db as any)
      .select({ id: rolePermissions.id })
      .from(rolePermissions)
      .where(
        and(
          eq(rolePermissions.propertyId, propertyId),
          eq(rolePermissions.roleId, roleId),
          eq(rolePermissions.permissionKey, permissionKey),
        ),
      )
      .limit(1);
    if (!grant) {
      await (db as any).insert(rolePermissions).values({
        propertyId,
        roleId,
        permissionKey,
      });
    }
  }

  return { roleId, created };
}

export async function linkIntegrationPrincipal(
  db: Db,
  input: LinkIntegrationPrincipalInput,
): Promise<LinkIntegrationPrincipalResult> {
  const { propertyId, keycloakSub, label, profile } = input;

  if (!isValidKeycloakSub(keycloakSub)) {
    throw new Error(`keycloakSub must be a UUID (service-account token sub): ${keycloakSub}`);
  }

  const [property] = await (db as any)
    .select({ id: properties.id })
    .from(properties)
    .where(eq(properties.id, propertyId))
    .limit(1);
  if (!property) {
    throw new Error(`Property ${propertyId} not found`);
  }

  const email = integrationPrincipalEmail(label);
  const name = `Integration: ${label.trim()}`;

  let roleKey: string;
  let roleId: string;
  let roleCreated = false;

  if (profile === 'custom') {
    const permissions = input.permissions ?? [];
    assertValidCustomPermissions(permissions);
    const customKey = `integration_${slugifyIntegrationLabel(label)}`;
    const [existingRole] = await (db as any)
      .select()
      .from(roles)
      .where(and(eq(roles.propertyId, propertyId), eq(roles.key, customKey)))
      .limit(1);

    if (existingRole) {
      roleId = existingRole.id;
      roleKey = existingRole.key;
    } else {
      const [row] = await (db as any)
        .insert(roles)
        .values({
          propertyId,
          key: customKey,
          name: `Integration: ${label.trim()}`,
          description: 'Custom integration principal role',
          isSystem: false,
        })
        .returning();
      roleId = row.id;
      roleKey = row.key;
      roleCreated = true;
    }

    for (const permissionKey of permissions) {
      const [grant] = await (db as any)
        .select({ id: rolePermissions.id })
        .from(rolePermissions)
        .where(
          and(
            eq(rolePermissions.propertyId, propertyId),
            eq(rolePermissions.roleId, roleId),
            eq(rolePermissions.permissionKey, permissionKey),
          ),
        )
        .limit(1);
      if (!grant) {
        await (db as any).insert(rolePermissions).values({
          propertyId,
          roleId,
          permissionKey,
        });
      }
    }
  } else {
    const def = INTEGRATION_PROFILES[profile];
    roleKey = def.roleKey;
    const ensured = await ensureSystemIntegrationRole(
      db,
      propertyId,
      def.roleKey,
      def.name,
      def.permissions,
    );
    roleId = ensured.roleId;
    roleCreated = ensured.created;
  }

  const [bySub] = await (db as any)
    .select()
    .from(users)
    .where(eq(users.keycloakSub, keycloakSub))
    .limit(1);

  let userId: string;
  let userCreated = false;

  if (bySub) {
    userId = bySub.id;
    if (bySub.propertyId !== propertyId) {
      throw new Error(
        `User linked to keycloakSub ${keycloakSub} belongs to another property (${bySub.propertyId})`,
      );
    }
    await (db as any)
      .update(users)
      .set({ name, updatedAt: new Date() })
      .where(eq(users.id, userId));
  } else {
    const [emailRow] = await (db as any)
      .select({ id: users.id, keycloakSub: users.keycloakSub })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    if (emailRow && emailRow.keycloakSub && emailRow.keycloakSub !== keycloakSub) {
      throw new Error(`Email ${email} is already used by another integration principal`);
    }

    if (emailRow) {
      userId = emailRow.id;
      await (db as any)
        .update(users)
        .set({ keycloakSub, name, propertyId, status: 'active', updatedAt: new Date() })
        .where(eq(users.id, userId));
    } else {
      const [user] = await (db as any)
        .insert(users)
        .values({
          propertyId,
          keycloakSub,
          email,
          name,
          status: 'active',
        })
        .returning();
      userId = user.id;
      userCreated = true;
    }
  }

  const [assignment] = await (db as any)
    .select({ id: userRoles.id })
    .from(userRoles)
    .where(
      and(eq(userRoles.userId, userId), eq(userRoles.roleId, roleId), eq(userRoles.propertyId, propertyId)),
    )
    .limit(1);

  let assignmentCreated = false;
  if (!assignment) {
    await (db as any).insert(userRoles).values({
      propertyId,
      userId,
      roleId,
    });
    assignmentCreated = true;
  }

  return {
    userId,
    roleId,
    roleKey,
    email,
    userCreated,
    roleCreated,
    assignmentCreated,
  };
}
