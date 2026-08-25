-- Migration 0031: keep stay-amendment corrections in the revenue ledger as signed, non-reversal
-- rows while retaining an immutable link to the component they adjust.
ALTER TABLE charges
  ADD COLUMN IF NOT EXISTS adjusts_charge_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS charges_property_id_unique
  ON charges (property_id, id);

DO $$ BEGIN
  IF EXISTS (
    SELECT 1
    FROM charges correction
    JOIN charges adjusted ON adjusted.id = correction.adjusts_charge_id
    WHERE correction.property_id <> adjusted.property_id
  ) THEN
    RAISE EXCEPTION 'charges.adjusts_charge_id must reference a charge in the same property';
  END IF;

  ALTER TABLE charges DROP CONSTRAINT IF EXISTS charges_adjusts_charge_fkey;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'charges_adjusts_charge_property_fkey'
      AND conrelid = 'charges'::regclass
  ) THEN
    ALTER TABLE charges
      ADD CONSTRAINT charges_adjusts_charge_property_fkey
      FOREIGN KEY (property_id, adjusts_charge_id)
      REFERENCES charges(property_id, id);
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
