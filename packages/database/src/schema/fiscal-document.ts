import { pgTable, uuid, varchar, text, timestamp, jsonb, pgEnum, index } from 'drizzle-orm/pg-core';
import { properties } from './property.js';
import { folios } from './folio.js';

export const fiscalDocumentStatusEnum = pgEnum('fiscal_document_status', [
  'requested', // Staff requested a fiscal document; awaiting external issuance
  'issued',    // External integration reported the issued document reference
  'voided',    // Document voided/cancelled (either before or after issuance)
]);

/**
 * Fiscal documents — references to official tax documents (invoices, tax
 * notes) issued for a folio by EXTERNAL regional integrations (e.g. NFS-e in
 * Brazil, e-invoicing mandates elsewhere).
 *
 * Core stores only the reference and lifecycle, never regional tax logic:
 * the actual issuance is performed by an external service subscribed to
 * `invoice.requested` webhooks, which reports the result back via the API.
 * Regional fields (series, verification codes, issuer ids, ...) belong in
 * `metadata`.
 */
export const fiscalDocuments = pgTable(
  'fiscal_documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id),
    folioId: uuid('folio_id')
      .notNull()
      .references(() => folios.id),

    // Regional document type identifier (e.g. "nfse", "invoice"). Core does
    // not interpret this value; it routes to the integration that does.
    documentType: varchar('document_type', { length: 50 }).notNull(),
    status: fiscalDocumentStatusEnum('status').notNull().default('requested'),

    // Set when the external integration reports issuance.
    documentNumber: varchar('document_number', { length: 100 }),
    documentUrl: text('document_url'), // Link to the official PDF/XML at the issuer
    issuedAt: timestamp('issued_at', { withTimezone: true }),

    voidedAt: timestamp('voided_at', { withTimezone: true }),
    voidReason: text('void_reason'),

    // Regional extras (series, verification code, municipal registration, ...)
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    propertyFolioIdx: index('fiscal_documents_property_folio_idx').on(
      table.propertyId,
      table.folioId,
    ),
  }),
);
