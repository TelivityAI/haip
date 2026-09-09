-- Guest return capabilities expose only status; raw references are never stored.
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS booking_return_reference_hash varchar(64);
CREATE UNIQUE INDEX IF NOT EXISTS payments_booking_return_reference_unique
  ON payments (booking_return_reference_hash);
