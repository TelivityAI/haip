-- role_permissions must be unique per property. The old unique index
-- (role_id, permission_key) made Cloud tenant bootstrap silently skip
-- permission grants once any other property had seeded the same system role.

DROP INDEX IF EXISTS role_permissions_role_perm_unique;

CREATE UNIQUE INDEX IF NOT EXISTS role_permissions_role_perm_unique
  ON role_permissions (property_id, role_id, permission_key);
