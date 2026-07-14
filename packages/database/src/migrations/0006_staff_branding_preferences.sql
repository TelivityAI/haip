-- Staff dashboard branding + user preferences (HIA polish)
ALTER TABLE properties ADD COLUMN IF NOT EXISTS staff_display_name varchar(200);
ALTER TABLE properties ADD COLUMN IF NOT EXISTS staff_logo_media_id uuid;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS staff_primary_color varchar(9);
ALTER TABLE properties ADD COLUMN IF NOT EXISTS staff_accent_color varchar(9);
ALTER TABLE users ADD COLUMN IF NOT EXISTS preferences jsonb NOT NULL DEFAULT '{}'::jsonb;
