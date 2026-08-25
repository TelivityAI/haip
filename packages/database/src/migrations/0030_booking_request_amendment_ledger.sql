-- Keep stay-amendment corrections in the revenue ledger as signed, non-reversal
-- rows while retaining an immutable link to the component they adjust.
ALTER TABLE charges
  ADD COLUMN IF NOT EXISTS adjusts_charge_id uuid;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'charges_adjusts_charge_fkey'
  ) THEN
    ALTER TABLE charges
      ADD CONSTRAINT charges_adjusts_charge_fkey
      FOREIGN KEY (adjusts_charge_id) REFERENCES charges(id);
  END IF;
END $$;

-- A once service is attributable to a concrete operational service date. Give
-- legacy accepted-pricing groups that same identity without touching amounts,
-- lock state, or their historical service date.
UPDATE charges current_charge
SET source_key = current_charge.source_key || ':'
  || to_char(current_charge.service_date AT TIME ZONE 'UTC', 'YYYY-MM-DD')
WHERE current_charge.source_key LIKE 'accepted-pricing:reservation-service:%:once'
  AND NOT EXISTS (
    SELECT 1
    FROM charges existing
    WHERE existing.property_id = current_charge.property_id
      AND existing.folio_id = current_charge.folio_id
      AND existing.source_key = current_charge.source_key || ':'
        || to_char(current_charge.service_date AT TIME ZONE 'UTC', 'YYYY-MM-DD')
  );
