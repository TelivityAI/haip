import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  timestamp,
  pgEnum,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { properties } from './property.js';

/**
 * Local authorization model — "local authz + Keycloak login".
 *
 * HAIP owns users / roles / permissions locally (property-scoped, custom roles,
 * per-feature permissions). Keycloak remains the OPTIONAL authenticator: when
 * AUTH_ENABLED=true it issues the JWT and `users.keycloakSub` links the local
 * user to the Keycloak subject (a LATER integration — nullable for now). When
 * AUTH_ENABLED=false (the demo), no Keycloak runs and these tables are still
 * fully managed through the admin console.
 *
 * Permissions themselves are NOT a table — they are a code-defined catalog
 * (apps/api/src/modules/auth/permissions.catalog.ts) because each key maps 1:1
 * to an API capability / nav item that only exists in code. Roles, role→
 * permission grants, and user→role assignments ARE database-managed.
 */
export const userStatusEnum = pgEnum('user_status', [
  'active',
  'disabled',
  'invited',
]);

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Nullable propertyId = cross-property / global operator (e.g. a chain admin).
    propertyId: uuid('property_id').references(() => properties.id),
    // Link to the Keycloak subject when real auth is enabled (LATER). Nullable
    // so demo users and locally-created users exist without a Keycloak account.
    keycloakSub: uuid('keycloak_sub'),
    email: varchar('email', { length: 255 }).notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    status: userStatusEnum('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    emailUnique: uniqueIndex('users_email_unique').on(t.email),
    keycloakSubIdx: index('users_keycloak_sub_idx').on(t.keycloakSub),
  }),
);

export const roles = pgTable(
  'roles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Nullable propertyId = a system/global role (e.g. 'admin'). Property-scoped
    // custom roles set propertyId.
    propertyId: uuid('property_id').references(() => properties.id),
    key: varchar('key', { length: 50 }).notNull(), // 'admin','front_desk',... or custom
    name: varchar('name', { length: 100 }).notNull(),
    description: text('description'),
    isSystem: boolean('is_system').notNull().default(false), // system roles can't be edited/deleted
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // One role key per property scope (null propertyId = the global namespace).
    propertyKeyUnique: uniqueIndex('roles_property_key_unique').on(t.propertyId, t.key),
  }),
);

export const rolePermissions = pgTable(
  'role_permissions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id),
    // FK-by-convention to the code catalog; validated in the service.
    permissionKey: varchar('permission_key', { length: 100 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    rolePermUnique: uniqueIndex('role_permissions_role_perm_unique').on(t.roleId, t.permissionKey),
  }),
);

export const userRoles = pgTable(
  'user_roles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userRoleUnique: uniqueIndex('user_roles_user_role_unique').on(t.userId, t.roleId),
    userIdx: index('user_roles_user_idx').on(t.userId),
  }),
);
