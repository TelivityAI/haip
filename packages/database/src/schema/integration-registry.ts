import {
  boolean,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { properties } from './property.js';

export const integrationCatalogStatusEnum = pgEnum('integration_catalog_status', [
  'shipped',
  'recipe',
  'adapter',
  'planned',
]);

/**
 * Public integration catalog (global product metadata, not tenant data).
 */
export const integrationCatalogEntries = pgTable('integration_catalog_entries', {
  slug: varchar('slug', { length: 120 }).primaryKey(),
  category: varchar('category', { length: 80 }).notNull(),
  name: varchar('name', { length: 160 }).notNull(),
  status: integrationCatalogStatusEnum('status').notNull(),
  docsPath: text('docs_path'),
  adapterKey: varchar('adapter_key', { length: 80 }),
  description: varchar('description', { length: 300 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Per-property enablement and configuration for a catalog entry. */
export const propertyIntegrations = pgTable(
  'property_integrations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id),
    catalogSlug: varchar('catalog_slug', { length: 120 })
      .notNull()
      .references(() => integrationCatalogEntries.slug),
    enabled: boolean('enabled').notNull().default(true),
    config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    propertyCatalogUnique: uniqueIndex('property_integrations_property_catalog_idx').on(
      table.propertyId,
      table.catalogSlug,
    ),
  }),
);
