-- Non-sensitive card-guarantee metadata on a reservation (status, brand, last4,
-- expiry, holder, verifiedAt, reason — never raw PAN or CVV).
ALTER TABLE reservations
  ADD COLUMN IF NOT EXISTS card_guarantee jsonb;
