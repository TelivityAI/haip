-- Reconcile properties.total_rooms with the count of active rooms.
-- Idempotent: a second run changes nothing once the counts match.
-- Properties with no active rooms are left alone (a zero inventory is not
-- evidence the stored total is wrong).

UPDATE properties AS p
SET total_rooms = active.cnt,
    updated_at = now()
FROM (
  SELECT property_id, count(*)::int AS cnt
  FROM rooms
  WHERE is_active = true
  GROUP BY property_id
  HAVING count(*) >= 1
) AS active
WHERE p.id = active.property_id
  AND p.total_rooms IS DISTINCT FROM active.cnt;
