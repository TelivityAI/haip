-- Widen charges.tax_rate to the same scale as tax_rules.rate.
ALTER TABLE charges
  ALTER COLUMN tax_rate TYPE numeric(8, 4);
