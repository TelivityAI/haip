-- user_roles must be unique per property. The old unique index (user_id, role_id)
-- blocked assigning the same system role to one integration principal across
-- multiple properties — the shape JWT property_ids + per-property grants require.

DROP INDEX IF EXISTS user_roles_user_role_unique;

CREATE UNIQUE INDEX IF NOT EXISTS user_roles_user_role_unique
  ON user_roles (user_id, role_id, property_id);
