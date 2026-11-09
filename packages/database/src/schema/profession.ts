import { pgTable, uuid, varchar, boolean, timestamp, jsonb, index } from 'drizzle-orm/pg-core';

/**
 * Global professions / occupations catalog (not property-scoped).
 *
 * Supports standard occupational codes (CBO, SOC, …), staff-created custom
 * values, and optional metadata for fiscal integrations (e.g. FNRH).
 *
 * System CBO/SOC seed data is intentionally not shipped in the initial
 * migration — entries accumulate via find-or-create from guest registration
 * and a future seed follow-up can mark official rows with `is_system = true`.
 */
export const professions = pgTable(
  'professions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 200 }).notNull(),
    code: varchar('code', { length: 50 }),
    countryCode: varchar('country_code', { length: 2 }),
    isSystem: boolean('is_system').notNull().default(false),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('professions_name_idx').on(table.name),
    index('professions_code_idx').on(table.code),
    index('professions_country_idx').on(table.countryCode),
  ],
);
