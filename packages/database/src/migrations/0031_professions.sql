-- Global professions catalog (not property-scoped).
-- Official CBO/SOC seed rows are a follow-up; this migration only creates the table.
CREATE TABLE IF NOT EXISTS "professions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(200) NOT NULL,
	"code" varchar(50),
	"country_code" varchar(2),
	"is_system" boolean DEFAULT false NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "professions_name_idx" ON "professions" USING btree ("name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "professions_code_idx" ON "professions" USING btree ("code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "professions_country_idx" ON "professions" USING btree ("country_code");
