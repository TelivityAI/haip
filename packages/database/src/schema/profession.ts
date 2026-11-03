import { pgTable, uuid, varchar, boolean, timestamp, jsonb, index } from 'drizzle-orm/pg-core';

/**
 * Professions / Occupations catalog.
 * Global dictionary supporting standard codes (such as CBO for Brazil, SOC for US, etc.),
 * arbitrary custom additions by users, and structured metadata for fiscal integrations like FNRH.
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
