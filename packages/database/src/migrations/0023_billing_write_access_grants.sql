-- Billing controllers left behind by #340 move onto @RequirePermissions().
-- Folio / cashier / house-account / accounting / notifications used to share
-- one realm-role list (admin, GM, front_desk, reservations, night_auditor,
-- accounting). PaymentController did NOT — its mutation routes were only
-- admin / GM / front_desk / reservations. This migration preserves folio-side
-- write access for the roles that already had it, grants accounting the
-- payment-refund access FO already had, and deliberately omits payments.refund
-- from night_auditor (overnight posting yes; guest refunds / voids no).
--
-- admin and general_manager need no grant here: admin holds every key via
-- ALL_PERMISSIONS, and general_manager holds every key except the two
-- admin.* ones, so brand-new keys (accounting.manage, payments.refund) are
-- automatic for both the moment they exist in the code catalog.

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
    ('front_desk', 'payments.refund'),
    ('night_auditor', 'folios.manage'),
    ('night_auditor', 'houseaccounts.manage'),
    ('night_auditor', 'communications.manage'),
    ('night_auditor', 'accounting.manage'),
    ('accounting', 'communications.manage'),
    ('accounting', 'accounting.manage'),
    ('accounting', 'payments.refund'),
    ('reservations', 'folios.manage'),
    ('reservations', 'houseaccounts.manage'),
    ('reservations', 'cashier.access'),
    ('reservations', 'accounting.manage'),
    ('reservations', 'payments.refund')
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
