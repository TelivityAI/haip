-- Migration: add 'pix' to payment_method enum.
--
-- Brazilian hotels record guest PIX transfers paid directly to the property
-- (outside Stripe) the same way as cash / bank_transfer — a manual settle
-- tender on the folio. Distinct from physical cash for reporting.
--
-- drizzle-kit generate cannot run in this repo (CJS/.js extension issue —
-- see packages/database/src/push-schema.ts), so this migration is authored
-- by hand. push-schema.ts also reflects the same DDL idempotently.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'payment_method'
      AND e.enumlabel = 'pix'
  ) THEN
    ALTER TYPE payment_method ADD VALUE 'pix';
  END IF;
END $$;
