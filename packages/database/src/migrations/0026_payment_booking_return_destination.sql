-- Persist the prevalidated hotel page so hosted return URLs can stay compact.
-- The raw return capability is appended only after lookup, never stored here.
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS booking_return_destination text;
