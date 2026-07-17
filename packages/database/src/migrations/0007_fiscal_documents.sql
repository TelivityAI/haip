-- Fiscal documents: references to official tax documents (invoices, tax notes)
-- issued for a folio by external regional integrations (invoice.* events).
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'fiscal_document_status') THEN
  CREATE TYPE fiscal_document_status AS ENUM ('requested','issued','voided');
END IF; END $$;

CREATE TABLE IF NOT EXISTS fiscal_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES properties(id),
  folio_id uuid NOT NULL REFERENCES folios(id),
  document_type varchar(50) NOT NULL,
  status fiscal_document_status NOT NULL DEFAULT 'requested',
  document_number varchar(100),
  document_url text,
  issued_at timestamptz,
  voided_at timestamptz,
  void_reason text,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS fiscal_documents_property_folio_idx
  ON fiscal_documents (property_id, folio_id);
