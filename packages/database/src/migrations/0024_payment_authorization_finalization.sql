-- Preserve server-side booking intent until asynchronous authorization completes.
-- Existing payments remain NULL; their purpose cannot safely be inferred.
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS authorization_finalization jsonb;
