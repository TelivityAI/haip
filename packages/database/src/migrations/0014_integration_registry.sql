-- Integration catalog (global) + per-property enablement.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'integration_catalog_status') THEN
    CREATE TYPE integration_catalog_status AS ENUM ('shipped', 'recipe', 'adapter', 'planned');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS integration_catalog_entries (
  slug varchar(120) PRIMARY KEY,
  category varchar(80) NOT NULL,
  name varchar(160) NOT NULL,
  status integration_catalog_status NOT NULL,
  docs_path text,
  adapter_key varchar(80),
  description varchar(300) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS integration_catalog_entries_category_idx
  ON integration_catalog_entries (category);

CREATE INDEX IF NOT EXISTS integration_catalog_entries_status_idx
  ON integration_catalog_entries (status);

CREATE TABLE IF NOT EXISTS property_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES properties(id),
  catalog_slug varchar(120) NOT NULL REFERENCES integration_catalog_entries(slug),
  enabled boolean NOT NULL DEFAULT true,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS property_integrations_property_catalog_idx
  ON property_integrations (property_id, catalog_slug);

CREATE INDEX IF NOT EXISTS property_integrations_property_idx
  ON property_integrations (property_id);

INSERT INTO integration_catalog_entries
  (slug, category, name, status, docs_path, adapter_key, description)
VALUES
  ('pmsxchange-siteminder', 'Channel Managers', 'pmsXchange (SiteMinder)', 'adapter', 'docs/INTEGRATIONS.md#channel-managers', 'siteminder', 'Channel manager connectivity for rates, availability, restrictions, reservations, and inventory updates through SiteMinder.'),
  ('derbysoft-property-connector', 'Channel Managers', 'DerbySoft Property Connector', 'adapter', 'docs/INTEGRATIONS.md#channel-managers', 'derbysoft', 'Property connector support for hotel content, rates, availability, and reservations through DerbySoft.'),
  ('beds24', 'Channel Managers', 'Beds24', 'planned', 'docs/INTEGRATIONS.md#channel-managers', NULL, 'Channel manager adapter for rates, inventory, availability, and booking import from Beds24-connected channels.'),
  ('expedia-eqc', 'Channel Managers', 'Expedia EQC', 'planned', 'docs/INTEGRATIONS.md#channel-managers', NULL, 'Expedia QuickConnect-style channel connectivity for availability, rates, booking delivery, and reservation lifecycle updates.'),
  ('channex', 'Channel Managers', 'Channex', 'planned', 'docs/INTEGRATIONS.md#channel-managers', NULL, 'Modern channel manager API support for ARI, restrictions, mappings, and booking delivery.'),
  ('hotelrunner', 'Channel Managers', 'HotelRunner', 'planned', 'docs/INTEGRATIONS.md#channel-managers', NULL, 'HotelRunner channel manager support for inventory, rate updates, restrictions, and reservation import.'),
  ('stripe', 'Payments', 'Stripe', 'shipped', 'docs/INTEGRATIONS.md#payments', 'stripe', 'Card payment integration for tokenized payments, payment intents, refunds, and transaction records.'),
  ('adyen', 'Payments', 'Adyen', 'planned', 'docs/INTEGRATIONS.md#payments', NULL, 'Payment service provider adapter path for tokenization, authorization, capture, refunds, and acquiring.'),
  ('square', 'Payments', 'Square', 'planned', 'docs/INTEGRATIONS.md#payments', NULL, 'Payment and terminal connectivity for tokenized in-person and online payments, refunds, and reconciliation.'),
  ('mollie', 'Payments', 'Mollie', 'planned', 'docs/INTEGRATIONS.md#payments', NULL, 'European payment method support for cards, local payment rails, refunds, and settlement-aware reporting.'),
  ('whatsapp-cloud-api', 'Guest Messaging', 'WhatsApp Cloud API', 'planned', 'docs/INTEGRATIONS.md#guest-messaging', NULL, 'WhatsApp Business messaging support for templates, session messages, delivery status, and guest conversations.'),
  ('twilio-conversations-whatsapp', 'Guest Messaging', 'Twilio Conversations/WhatsApp', 'planned', 'docs/INTEGRATIONS.md#guest-messaging', NULL, 'Omnichannel conversation support for SMS, WhatsApp, and agent-assisted guest messaging.'),
  ('chatwoot', 'Guest Messaging', 'Chatwoot', 'planned', 'docs/INTEGRATIONS.md#guest-messaging', NULL, 'Open-source inbox integration for guest messaging, team assignment, and conversation history.'),
  ('mailgun', 'Email, Marketing & CRM', 'Mailgun', 'planned', 'docs/INTEGRATIONS.md#email-marketing--crm', NULL, 'Transactional email support for confirmations, receipts, operational notices, and delivery tracking.'),
  ('amazon-ses', 'Email, Marketing & CRM', 'Amazon SES', 'planned', 'docs/INTEGRATIONS.md#email-marketing--crm', NULL, 'Scalable SMTP and API email delivery for confirmations, receipts, and operational notifications.'),
  ('sendgrid', 'Email, Marketing & CRM', 'SendGrid', 'planned', 'docs/INTEGRATIONS.md#email-marketing--crm', NULL, 'Email API support for transactional templates, marketing lists, and delivery event webhooks.'),
  ('mailchimp', 'Email, Marketing & CRM', 'Mailchimp', 'planned', 'docs/INTEGRATIONS.md#email-marketing--crm', NULL, 'Marketing audience sync, campaign triggers, and guest lifecycle messaging support.'),
  ('zapier', 'Automation Platforms', 'Zapier', 'recipe', 'docs/INTEGRATIONS.md#automation-platforms', NULL, 'No-code automation support through webhooks and API actions for guest, reservation, and operational workflows.'),
  ('slack-incoming-webhooks', 'Automation Platforms', 'Slack Incoming Webhooks', 'recipe', 'docs/INTEGRATIONS.md#automation-platforms', NULL, 'Slack notification support for reservation events, operational alerts, and team updates.'),
  ('n8n', 'Automation Platforms', 'n8n', 'recipe', 'docs/INTEGRATIONS.md#automation-platforms', NULL, 'Open workflow automation support through webhooks, HTTP nodes, and API-key authenticated calls.'),
  ('pipedream', 'Automation Platforms', 'Pipedream', 'planned', 'docs/INTEGRATIONS.md#automation-platforms', NULL, 'Developer automation support for event-driven workflows, API calls, and custom code steps.'),
  ('make-com', 'Automation Platforms', 'Make.com', 'recipe', 'docs/INTEGRATIONS.md#automation-platforms', NULL, 'Scenario automation support through webhooks, HTTP modules, and connected app workflows.'),
  ('discord-webhooks', 'Automation Platforms', 'Discord Webhooks', 'recipe', 'docs/INTEGRATIONS.md#automation-platforms', NULL, 'Discord notification support for operational channels, alerts, and team-visible event streams.'),
  ('google-chat-incoming-webhooks', 'Automation Platforms', 'Google Chat Incoming Webhooks', 'planned', 'docs/INTEGRATIONS.md#automation-platforms', NULL, 'Google Chat notification support for reservation events, alerts, and team spaces.'),
  ('looker-studio', 'BI & Analytics', 'Looker Studio', 'planned', 'docs/INTEGRATIONS.md#bi--analytics', NULL, 'Reporting support through structured exports, database connections, and dashboard-ready datasets.'),
  ('metabase', 'BI & Analytics', 'Metabase', 'recipe', 'docs/INTEGRATIONS.md#bi--analytics', NULL, 'Open-source BI support for PostgreSQL reporting, dashboards, and scheduled analytics.'),
  ('grafana', 'BI & Analytics', 'Grafana', 'planned', 'docs/INTEGRATIONS.md#bi--analytics', NULL, 'Metrics and dashboard support for operations, system health, and business observability.'),
  ('ical-import-export', 'Open Standards & Infrastructure', 'iCal Import/Export', 'recipe', 'docs/INTEGRATIONS.md#open-standards--infrastructure', NULL, 'Calendar standard support for availability import, availability export, and channel calendar bridging.'),
  ('opentravel-htng-xml', 'Open Standards & Infrastructure', 'OpenTravel/HTNG XML', 'planned', 'docs/INTEGRATIONS.md#open-standards--infrastructure', NULL, 'Hospitality XML standard support for distribution, reservations, profiles, and operational interoperability.'),
  ('frankfurter-ecb-fx', 'Open Standards & Infrastructure', 'Frankfurter/ECB FX', 'planned', 'docs/INTEGRATIONS.md#open-standards--infrastructure', NULL, 'Foreign exchange rate support based on European Central Bank reference data.'),
  ('generic-post-charge-to-folio-open-pattern', 'Point of Sale', 'Generic Post Charge to Folio open pattern', 'recipe', 'docs/INTEGRATIONS.md#point-of-sale', NULL, 'Open inbound pattern for POS systems that can send authenticated charge, tax, and payment details to a folio.'),
  ('salto-ks', 'Door Locks & Access', 'Salto KS', 'planned', 'docs/INTEGRATIONS.md#door-locks--access', NULL, 'Cloud access control support for issuing, updating, and revoking guest and staff access.'),
  ('nuki', 'Door Locks & Access', 'Nuki', 'planned', 'docs/INTEGRATIONS.md#door-locks--access', NULL, 'Smart lock support for access grants, time windows, revocation, and operational status.'),
  ('serbia-suf-esir', 'Fiscalization & Tax Compliance (worldwide)', 'Serbia SUF/ESIR', 'planned', 'docs/INTEGRATIONS.md#fiscalization--tax-compliance-worldwide', NULL, 'Fiscal device and receipt workflow support for Serbian fiscalization requirements.'),
  ('italy-sdi', 'Fiscalization & Tax Compliance (worldwide)', 'Italy SDI', 'planned', 'docs/INTEGRATIONS.md#fiscalization--tax-compliance-worldwide', NULL, 'E-invoicing support for Italian Sistema di Interscambio invoice exchange.'),
  ('poland-ksef', 'Fiscalization & Tax Compliance (worldwide)', 'Poland KSeF', 'planned', 'docs/INTEGRATIONS.md#fiscalization--tax-compliance-worldwide', NULL, 'National e-invoicing support for Polish structured invoice exchange.'),
  ('serbia-eturista', 'ID Verification & Online Check-in', 'Serbia eTurista', 'planned', 'docs/INTEGRATIONS.md#id-verification--online-check-in', NULL, 'Guest registration pathway for Serbian accommodation reporting requirements.')
ON CONFLICT (slug) DO UPDATE SET
  category = EXCLUDED.category,
  name = EXCLUDED.name,
  status = EXCLUDED.status,
  docs_path = EXCLUDED.docs_path,
  adapter_key = EXCLUDED.adapter_key,
  description = EXCLUDED.description,
  updated_at = now();
