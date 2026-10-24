-- Online guest check-in: per-room lock mapping + guest ID photo media ref.
ALTER TABLE rooms
  ADD COLUMN IF NOT EXISTS external_lock_id varchar(100);

COMMENT ON COLUMN rooms.external_lock_id IS
  'Vendor lock/device id for the room (Nuki/TTLock/Salto/webhook middleware).';

ALTER TABLE reservations
  ADD COLUMN IF NOT EXISTS online_check_in_completed_at timestamptz;

COMMENT ON COLUMN reservations.online_check_in_completed_at IS
  'When the guest completed self check-in via the phone flow (null if desk-only).';
