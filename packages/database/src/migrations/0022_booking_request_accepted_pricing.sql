-- Freeze the operational tariff chosen during Booking Request acceptance.
-- Existing reservations remain NULL and continue using their canonical live
-- rate-plan/night-audit behavior.
ALTER TABLE reservations
  ADD COLUMN IF NOT EXISTS accepted_pricing_snapshot jsonb;
