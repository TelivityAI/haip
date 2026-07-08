import { pgTable, uuid, varchar, timestamp } from 'drizzle-orm/pg-core';

/**
 * Organization — hotel group / chain that owns one or more properties.
 * Enables portfolio-level reporting across properties in the same org.
 */
export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull(),
  code: varchar('code', { length: 20 }).notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
