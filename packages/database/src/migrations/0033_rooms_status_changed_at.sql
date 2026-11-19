-- Rooms carry the instant their operational status last changed, so "how long has
-- this room been out of order" is answerable without inferring it from updated_at
-- (which also moves on notes-only edits). Additive: existing rows backfill from
-- the closest timestamp already available.
ALTER TABLE rooms
  ADD COLUMN IF NOT EXISTS status_changed_at timestamptz NOT NULL DEFAULT now();

UPDATE rooms
   SET status_changed_at = COALESCE(updated_at, created_at)
 WHERE status_changed_at IS NULL;
