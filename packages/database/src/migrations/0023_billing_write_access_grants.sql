-- The 6 billing-adjacent controllers (folio's charge/settle/close routes,
-- payment, notifications, house-account, cashier, accounting) used to gate
-- every route -- read and write alike -- with one Keycloak realm-role list:
-- admin, general_manager, front_desk, reservations, night_auditor,
-- accounting. Moving those routes onto local @RequirePermissions() (see the
-- RBAC migration continuing #340) surfaced that four of those six roles were missing
-- permission keys the old realm-role gate had been granting them all along.
-- The rule applied is to preserve what the realm-role gate was granting in
-- practice rather than narrow it silently: reservations-desk staff keep the
-- ability to record payments and post charges, and night_auditor/accounting
-- get the keys the old list already gave them.
--
-- admin and general_manager need no grant here: admin holds every key via
-- ALL_PERMISSIONS, and general_manager holds every key except the two
-- admin.* ones, so a brand-new key like accounting.manage is automatic for
-- both the moment it exists in the code catalog -- see permissions.catalog.ts.

WITH role_ids AS (
  SELECT key, id AS role_id
  FROM roles
  WHERE property_id IS NULL
    AND is_system = true
    AND key IN ('front_desk', 'night_auditor', 'accounting', 'reservations')
),
grants(role_key, permission_key) AS (
  VALUES
    ('front_desk', 'cashier.access'),
    ('front_desk', 'accounting.manage'),
    ('night_auditor', 'folios.manage'),
    ('night_auditor', 'houseaccounts.manage'),
    ('night_auditor', 'communications.manage'),
    ('night_auditor', 'accounting.manage'),
    ('accounting', 'communications.manage'),
    ('accounting', 'accounting.manage'),
    ('reservations', 'folios.manage'),
    ('reservations', 'houseaccounts.manage'),
    ('reservations', 'cashier.access'),
    ('reservations', 'accounting.manage')
),
resolved AS (
  SELECT r.role_id, g.permission_key
  FROM grants g
  JOIN role_ids r ON r.key = g.role_key
)
-- Same "every property that already has RBAC grants" cross-join as 0015 --
-- a property with zero role_permissions rows gets nothing here either, by
-- design (it has no RBAC set up at all yet, so there is nothing to widen).
INSERT INTO role_permissions (id, property_id, role_id, permission_key)
SELECT gen_random_uuid(), prop.id, res.role_id, res.permission_key
FROM (
  SELECT DISTINCT property_id AS id
  FROM role_permissions
) prop
CROSS JOIN resolved res
ON CONFLICT (property_id, role_id, permission_key) DO NOTHING;
