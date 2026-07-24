export type IntegrationRegistrySeedRow = {
  slug: string;
  category: string;
  name: string;
  status: 'shipped' | 'recipe' | 'adapter' | 'planned';
  docsPath: string | null;
  adapterKey: string | null;
  description: string;
};

export const INTEGRATION_REGISTRY_SEED: IntegrationRegistrySeedRow[] = [
  {
    slug: 'pmsxchange-siteminder',
    category: 'Channel Managers',
    name: 'pmsXchange (SiteMinder)',
    status: 'adapter',
    docsPath: 'docs/INTEGRATIONS.md#channel-managers',
    adapterKey: 'siteminder',
    description:
      'Channel manager connectivity for rates, availability, restrictions, reservations, and inventory updates through SiteMinder.',
  },
  {
    slug: 'derbysoft-property-connector',
    category: 'Channel Managers',
    name: 'DerbySoft Property Connector',
    status: 'adapter',
    docsPath: 'docs/INTEGRATIONS.md#channel-managers',
    adapterKey: 'derbysoft',
    description:
      'Property connector support for hotel content, rates, availability, and reservations through DerbySoft.',
  },
  {
    slug: 'beds24',
    category: 'Channel Managers',
    name: 'Beds24',
    status: 'planned',
    docsPath: 'docs/INTEGRATIONS.md#channel-managers',
    adapterKey: null,
    description:
      'Channel manager adapter for rates, inventory, availability, and booking import from Beds24-connected channels.',
  },
  {
    slug: 'expedia-eqc',
    category: 'Channel Managers',
    name: 'Expedia EQC',
    status: 'planned',
    docsPath: 'docs/INTEGRATIONS.md#channel-managers',
    adapterKey: null,
    description:
      'Expedia QuickConnect-style channel connectivity for availability, rates, booking delivery, and reservation lifecycle updates.',
  },
  {
    slug: 'channex',
    category: 'Channel Managers',
    name: 'Channex',
    status: 'planned',
    docsPath: 'docs/INTEGRATIONS.md#channel-managers',
    adapterKey: null,
    description:
      'Modern channel manager API support for ARI, restrictions, mappings, and booking delivery.',
  },
  {
    slug: 'hotelrunner',
    category: 'Channel Managers',
    name: 'HotelRunner',
    status: 'planned',
    docsPath: 'docs/INTEGRATIONS.md#channel-managers',
    adapterKey: null,
    description:
      'HotelRunner channel manager support for inventory, rate updates, restrictions, and reservation import.',
  },
  {
    slug: 'stripe',
    category: 'Payments',
    name: 'Stripe',
    status: 'shipped',
    docsPath: 'docs/INTEGRATIONS.md#payments',
    adapterKey: 'stripe',
    description:
      'Card payment integration for tokenized payments, payment intents, refunds, and transaction records.',
  },
  {
    slug: 'adyen',
    category: 'Payments',
    name: 'Adyen',
    status: 'planned',
    docsPath: 'docs/INTEGRATIONS.md#payments',
    adapterKey: null,
    description:
      'Payment service provider adapter path for tokenization, authorization, capture, refunds, and acquiring.',
  },
  {
    slug: 'square',
    category: 'Payments',
    name: 'Square',
    status: 'planned',
    docsPath: 'docs/INTEGRATIONS.md#payments',
    adapterKey: null,
    description:
      'Payment and terminal connectivity for tokenized in-person and online payments, refunds, and reconciliation.',
  },
  {
    slug: 'mollie',
    category: 'Payments',
    name: 'Mollie',
    status: 'planned',
    docsPath: 'docs/INTEGRATIONS.md#payments',
    adapterKey: null,
    description:
      'European payment method support for cards, local payment rails, refunds, and settlement-aware reporting.',
  },
  {
    slug: 'whatsapp-cloud-api',
    category: 'Guest Messaging',
    name: 'WhatsApp Cloud API',
    status: 'planned',
    docsPath: 'docs/INTEGRATIONS.md#guest-messaging',
    adapterKey: null,
    description:
      'WhatsApp Business messaging support for templates, session messages, delivery status, and guest conversations.',
  },
  {
    slug: 'twilio-conversations-whatsapp',
    category: 'Guest Messaging',
    name: 'Twilio Conversations/WhatsApp',
    status: 'planned',
    docsPath: 'docs/INTEGRATIONS.md#guest-messaging',
    adapterKey: null,
    description:
      'Omnichannel conversation support for SMS, WhatsApp, and agent-assisted guest messaging.',
  },
  {
    slug: 'chatwoot',
    category: 'Guest Messaging',
    name: 'Chatwoot',
    status: 'planned',
    docsPath: 'docs/INTEGRATIONS.md#guest-messaging',
    adapterKey: null,
    description:
      'Open-source inbox integration for guest messaging, team assignment, and conversation history.',
  },
  {
    slug: 'mailgun',
    category: 'Email, Marketing & CRM',
    name: 'Mailgun',
    status: 'planned',
    docsPath: 'docs/INTEGRATIONS.md#email-marketing--crm',
    adapterKey: null,
    description:
      'Transactional email support for confirmations, receipts, operational notices, and delivery tracking.',
  },
  {
    slug: 'amazon-ses',
    category: 'Email, Marketing & CRM',
    name: 'Amazon SES',
    status: 'planned',
    docsPath: 'docs/INTEGRATIONS.md#email-marketing--crm',
    adapterKey: null,
    description:
      'Scalable SMTP and API email delivery for confirmations, receipts, and operational notifications.',
  },
  {
    slug: 'sendgrid',
    category: 'Email, Marketing & CRM',
    name: 'SendGrid',
    status: 'planned',
    docsPath: 'docs/INTEGRATIONS.md#email-marketing--crm',
    adapterKey: null,
    description:
      'Email API support for transactional templates, marketing lists, and delivery event webhooks.',
  },
  {
    slug: 'mailchimp',
    category: 'Email, Marketing & CRM',
    name: 'Mailchimp',
    status: 'planned',
    docsPath: 'docs/INTEGRATIONS.md#email-marketing--crm',
    adapterKey: null,
    description:
      'Marketing audience sync, campaign triggers, and guest lifecycle messaging support.',
  },
  {
    slug: 'zapier',
    category: 'Automation Platforms',
    name: 'Zapier',
    status: 'recipe',
    docsPath: 'docs/INTEGRATIONS.md#automation-platforms',
    adapterKey: null,
    description:
      'No-code automation support through webhooks and API actions for guest, reservation, and operational workflows.',
  },
  {
    slug: 'slack-incoming-webhooks',
    category: 'Automation Platforms',
    name: 'Slack Incoming Webhooks',
    status: 'recipe',
    docsPath: 'docs/INTEGRATIONS.md#automation-platforms',
    adapterKey: null,
    description:
      'Slack notification support for reservation events, operational alerts, and team updates.',
  },
  {
    slug: 'n8n',
    category: 'Automation Platforms',
    name: 'n8n',
    status: 'recipe',
    docsPath: 'docs/INTEGRATIONS.md#automation-platforms',
    adapterKey: null,
    description:
      'Open workflow automation support through webhooks, HTTP nodes, and API-key authenticated calls.',
  },
  {
    slug: 'pipedream',
    category: 'Automation Platforms',
    name: 'Pipedream',
    status: 'planned',
    docsPath: 'docs/INTEGRATIONS.md#automation-platforms',
    adapterKey: null,
    description:
      'Developer automation support for event-driven workflows, API calls, and custom code steps.',
  },
  {
    slug: 'make-com',
    category: 'Automation Platforms',
    name: 'Make.com',
    status: 'recipe',
    docsPath: 'docs/INTEGRATIONS.md#automation-platforms',
    adapterKey: null,
    description:
      'Scenario automation support through webhooks, HTTP modules, and connected app workflows.',
  },
  {
    slug: 'discord-webhooks',
    category: 'Automation Platforms',
    name: 'Discord Webhooks',
    status: 'recipe',
    docsPath: 'docs/INTEGRATIONS.md#automation-platforms',
    adapterKey: null,
    description:
      'Discord notification support for operational channels, alerts, and team-visible event streams.',
  },
  {
    slug: 'google-chat-incoming-webhooks',
    category: 'Automation Platforms',
    name: 'Google Chat Incoming Webhooks',
    status: 'planned',
    docsPath: 'docs/INTEGRATIONS.md#automation-platforms',
    adapterKey: null,
    description:
      'Google Chat notification support for reservation events, alerts, and team spaces.',
  },
  {
    slug: 'looker-studio',
    category: 'BI & Analytics',
    name: 'Looker Studio',
    status: 'planned',
    docsPath: 'docs/INTEGRATIONS.md#bi--analytics',
    adapterKey: null,
    description:
      'Reporting support through structured exports, database connections, and dashboard-ready datasets.',
  },
  {
    slug: 'metabase',
    category: 'BI & Analytics',
    name: 'Metabase',
    status: 'recipe',
    docsPath: 'docs/INTEGRATIONS.md#bi--analytics',
    adapterKey: null,
    description:
      'Open-source BI support for PostgreSQL reporting, dashboards, and scheduled analytics.',
  },
  {
    slug: 'grafana',
    category: 'BI & Analytics',
    name: 'Grafana',
    status: 'planned',
    docsPath: 'docs/INTEGRATIONS.md#bi--analytics',
    adapterKey: null,
    description:
      'Metrics and dashboard support for operations, system health, and business observability.',
  },
  {
    slug: 'ical-import-export',
    category: 'Open Standards & Infrastructure',
    name: 'iCal Import/Export',
    status: 'recipe',
    docsPath: 'docs/INTEGRATIONS.md#open-standards--infrastructure',
    adapterKey: null,
    description:
      'Calendar standard support for availability import, availability export, and channel calendar bridging.',
  },
  {
    slug: 'opentravel-htng-xml',
    category: 'Open Standards & Infrastructure',
    name: 'OpenTravel/HTNG XML',
    status: 'planned',
    docsPath: 'docs/INTEGRATIONS.md#open-standards--infrastructure',
    adapterKey: null,
    description:
      'Hospitality XML standard support for distribution, reservations, profiles, and operational interoperability.',
  },
  {
    slug: 'frankfurter-ecb-fx',
    category: 'Open Standards & Infrastructure',
    name: 'Frankfurter/ECB FX',
    status: 'planned',
    docsPath: 'docs/INTEGRATIONS.md#open-standards--infrastructure',
    adapterKey: null,
    description:
      'Foreign exchange rate support based on European Central Bank reference data.',
  },
  {
    slug: 'generic-post-charge-to-folio-open-pattern',
    category: 'Point of Sale',
    name: 'Generic Post Charge to Folio open pattern',
    status: 'recipe',
    docsPath: 'docs/INTEGRATIONS.md#point-of-sale',
    adapterKey: null,
    description:
      'Open inbound pattern for POS systems that can send authenticated charge, tax, and payment details to a folio.',
  },
  {
    slug: 'salto-ks',
    category: 'Door Locks & Access',
    name: 'Salto KS',
    status: 'planned',
    docsPath: 'docs/INTEGRATIONS.md#door-locks--access',
    adapterKey: null,
    description:
      'Cloud access control support for issuing, updating, and revoking guest and staff access.',
  },
  {
    slug: 'nuki',
    category: 'Door Locks & Access',
    name: 'Nuki',
    status: 'planned',
    docsPath: 'docs/INTEGRATIONS.md#door-locks--access',
    adapterKey: null,
    description:
      'Smart lock support for access grants, time windows, revocation, and operational status.',
  },
  {
    slug: 'serbia-suf-esir',
    category: 'Fiscalization & Tax Compliance (worldwide)',
    name: 'Serbia SUF/ESIR',
    status: 'planned',
    docsPath: 'docs/INTEGRATIONS.md#fiscalization--tax-compliance-worldwide',
    adapterKey: null,
    description:
      'Fiscal device and receipt workflow support for Serbian fiscalization requirements.',
  },
  {
    slug: 'italy-sdi',
    category: 'Fiscalization & Tax Compliance (worldwide)',
    name: 'Italy SDI',
    status: 'planned',
    docsPath: 'docs/INTEGRATIONS.md#fiscalization--tax-compliance-worldwide',
    adapterKey: null,
    description:
      'E-invoicing support for Italian Sistema di Interscambio invoice exchange.',
  },
  {
    slug: 'poland-ksef',
    category: 'Fiscalization & Tax Compliance (worldwide)',
    name: 'Poland KSeF',
    status: 'planned',
    docsPath: 'docs/INTEGRATIONS.md#fiscalization--tax-compliance-worldwide',
    adapterKey: null,
    description:
      'National e-invoicing support for Polish structured invoice exchange.',
  },
  {
    slug: 'serbia-eturista',
    category: 'ID Verification & Online Check-in',
    name: 'Serbia eTurista',
    status: 'planned',
    docsPath: 'docs/INTEGRATIONS.md#id-verification--online-check-in',
    adapterKey: null,
    description:
      'Guest registration pathway for Serbian accommodation reporting requirements.',
  },
];
