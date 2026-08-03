-- Additive system roles: general_manager, revenue_manager, accounting, reservations.
-- Does not rename/delete the original six system roles.

-- Stable IDs match packages/database/src/seed.ts sid('ee000001', 7..10).
INSERT INTO roles (id, property_id, key, name, description, is_system)
SELECT 'ee000001-0000-4000-a000-000000000007', NULL, 'general_manager', 'General Manager',
       'Built-in General Manager role', true
WHERE NOT EXISTS (
  SELECT 1 FROM roles WHERE key = 'general_manager' AND property_id IS NULL AND is_system = true
);

INSERT INTO roles (id, property_id, key, name, description, is_system)
SELECT 'ee000001-0000-4000-a000-000000000008', NULL, 'revenue_manager', 'Revenue Manager',
       'Built-in Revenue Manager role', true
WHERE NOT EXISTS (
  SELECT 1 FROM roles WHERE key = 'revenue_manager' AND property_id IS NULL AND is_system = true
);

INSERT INTO roles (id, property_id, key, name, description, is_system)
SELECT 'ee000001-0000-4000-a000-000000000009', NULL, 'accounting', 'Accounting',
       'Built-in Accounting role', true
WHERE NOT EXISTS (
  SELECT 1 FROM roles WHERE key = 'accounting' AND property_id IS NULL AND is_system = true
);

INSERT INTO roles (id, property_id, key, name, description, is_system)
SELECT 'ee000001-0000-4000-a000-00000000000a', NULL, 'reservations', 'Reservations',
       'Built-in Reservations role', true
WHERE NOT EXISTS (
  SELECT 1 FROM roles WHERE key = 'reservations' AND property_id IS NULL AND is_system = true
);

-- Per-property default grants for the new system roles (same keys as permissions.catalog.ts).
WITH role_ids AS (
  SELECT key, id AS role_id
  FROM roles
  WHERE property_id IS NULL
    AND is_system = true
    AND key IN ('general_manager', 'revenue_manager', 'accounting', 'reservations')
),
gm_perms(permission_key) AS (
  VALUES
    ('dashboard.view'), ('frontdesk.access'), ('reservations.read'), ('reservations.write'),
    ('guests.read'), ('guests.write'), ('rooms.read'), ('rooms.write'), ('media.manage'),
    ('housekeeping.read'), ('housekeeping.manage'), ('ops.read'), ('ops.manage'),
    ('folios.read'), ('folios.manage'), ('groups.read'), ('groups.manage'), ('commercial.read'),
    ('cashier.access'), ('houseaccounts.read'), ('houseaccounts.manage'),
    ('accounting.view'), ('tax.manage'),
    ('rateplans.read'), ('rateplans.manage'), ('services.read'), ('services.manage'),
    ('policies.read'), ('policies.manage'), ('revenue.manage'), ('nightaudit.run'),
    ('reports.view'), ('channels.manage'), ('communications.manage'), ('reviews.manage'),
    ('settings.manage'), ('bookingengine.manage')
),
rm_perms(permission_key) AS (
  VALUES
    ('dashboard.view'), ('reservations.read'), ('guests.read'), ('rooms.read'),
    ('groups.read'), ('groups.manage'), ('commercial.read'),
    ('rateplans.read'), ('rateplans.manage'), ('policies.read'), ('policies.manage'),
    ('revenue.manage'), ('channels.manage'), ('reports.view'), ('communications.manage')
),
acct_perms(permission_key) AS (
  VALUES
    ('dashboard.view'), ('reservations.read'), ('guests.read'),
    ('folios.read'), ('folios.manage'), ('houseaccounts.read'), ('houseaccounts.manage'),
    ('cashier.access'), ('accounting.view'), ('tax.manage'), ('nightaudit.run'),
    ('reports.view'), ('commercial.read')
),
res_perms(permission_key) AS (
  VALUES
    ('dashboard.view'), ('frontdesk.access'), ('reservations.read'), ('reservations.write'),
    ('guests.read'), ('guests.write'), ('rooms.read'), ('media.manage'), ('folios.read'),
    ('groups.read'), ('groups.manage'), ('commercial.read'),
    ('rateplans.read'), ('services.read'), ('services.manage'), ('policies.read'),
    ('communications.manage'), ('reviews.manage')
),
grants AS (
  SELECT r.role_id, p.permission_key
  FROM role_ids r
  JOIN gm_perms p ON r.key = 'general_manager'
  UNION ALL
  SELECT r.role_id, p.permission_key
  FROM role_ids r
  JOIN rm_perms p ON r.key = 'revenue_manager'
  UNION ALL
  SELECT r.role_id, p.permission_key
  FROM role_ids r
  JOIN acct_perms p ON r.key = 'accounting'
  UNION ALL
  SELECT r.role_id, p.permission_key
  FROM role_ids r
  JOIN res_perms p ON r.key = 'reservations'
)
-- role_permissions_role_perm_unique is (role_id, permission_key) — same as seed.
-- Insert for every property that already has RBAC grants; conflicts are skipped.
INSERT INTO role_permissions (id, property_id, role_id, permission_key)
SELECT gen_random_uuid(), prop.id, g.role_id, g.permission_key
FROM (
  SELECT DISTINCT property_id AS id
  FROM role_permissions
) prop
CROSS JOIN grants g
ON CONFLICT (role_id, permission_key) DO NOTHING;
