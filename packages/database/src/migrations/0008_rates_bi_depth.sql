-- LOS and occupancy-based pricing on rate plans; revenue-management pickup reporting support.
ALTER TABLE rate_plans ADD COLUMN IF NOT EXISTS los_adjustments jsonb;
ALTER TABLE rate_plans ADD COLUMN IF NOT EXISTS occupancy_bands jsonb;
