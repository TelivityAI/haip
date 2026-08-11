import { pgTable, uuid, varchar, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { properties } from './property.js';

/**
 * Encrypted source-PMS API credentials for automated migration (Mews, Cloudbeds,
 * Apaleo, OHIP). Plaintext secrets are AES-256-GCM encrypted at the app layer
 * before persistence — never stored in jsonb like channel_connections.config.
 *
 * Decrypted values are server-side only (migration runner); API responses expose
 * metadata only.
 */
export const migrationSourceCredentials = pgTable(
  'migration_source_credentials',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    propertyId: uuid('property_id').notNull().references(() => properties.id),
    /** Source PMS identifier, e.g. mews | cloudbeds | apaleo | ohip */
    sourcePms: varchar('source_pms', { length: 50 }).notNull(),
    /** JSON-serialized EncryptedCredentialBlob (iv + ciphertext + authTag + keyId) */
    ciphertext: text('ciphertext').notNull(),
    encryptionKeyId: varchar('encryption_key_id', { length: 50 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    rotatedAt: timestamp('rotated_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    propertySourceUnique: uniqueIndex('migration_source_credentials_property_source_unique').on(
      table.propertyId,
      table.sourcePms,
    ),
  }),
);
