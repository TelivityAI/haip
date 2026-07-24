# HAIP Integrations

HAIP is API-first: REST OpenAPI is available at `/docs`, HMAC-signed webhooks cover roughly 90 `entity.action` events with retries, WebSocket keeps operational clients current, and the platform connects to tools hotels use and anything that speaks HTTP.

Resources: [integration recipes](integrations/), [shipped demos](../integrations/demos/) (`./integrations/demos/run.sh <slug>`), and [webhooks](webhooks.md).

## How integrations work

- Webhooks out - `X-HAIP-Signature`, backoff
- REST API in - Connect API API-key scoped
- Pluggable adapters - channel managers, payments, locks, SMS, email
- Open standards - OpenTravel/OTA XML, iCal, SMTP, CSV, SQL PostgreSQL

## Built for compliance, worldwide

Selling rooms is global; receipts and guest registration are local law. HAIP treats government compliance as a first-class integration category across Europe and Latin America: fiscalization and e-invoicing (Italy SDI, Greece myDATA, Poland KSeF, Hungary NAV, Spain VeriFactu/SII, Portugal, Germany TSE, Austria RKSV, the Balkans, Mexico CFDI, Colombia DIAN, Chile, Argentina and more) and mandatory guest registration (Serbia eTurista, Croatia eVisitor, Italy Alloggiati Web, Czechia Ubyport, Spain SES Hospedajes, Hungary VIZA, Finland traveller notification, Colombia SIRE). Where a country has no mandate, or a mandate with no digital channel, that's documented too - no compliance theater.

## Integration catalog

19 categories, ~230 integrations, phased: automation/notifications/email/BI/standards first; vendor adapters next; certified distribution and country compliance as onboarding/market entry demand.

### Catalog status (registry)

The property Integrations dashboard / `GET /api/v1/admin/integrations` uses four statuses — **not** “only shipped counts”:

| Status | Meaning |
|--------|---------|
| `shipped` | In-product path you can enable (payments, channels, locks, SMS/email, etc.) |
| `adapter` | Provider key wired (often console/demo until partner credentials / authority clients) |
| `recipe` | Works today via docs + existing REST/webhooks/CSV/SQL — no vendor SDK required |
| `planned` | Partner/cert or country pack not started yet |

The flat list below is the full public surface. Registry seed status is the maturity filter on top of that list.

### Channel Managers

- **pmsXchange (SiteMinder)** - Channel manager connectivity for rates, availability, restrictions, reservations, and inventory updates through SiteMinder's PMS exchange model.
- **Myallocator/Cloudbeds** - Cloudbeds channel manager connectivity for property inventory, rate plans, and reservation synchronization.
- **Expedia EQC** - Expedia QuickConnect-style channel connectivity for availability, rates, booking delivery, and reservation lifecycle updates.
- **DerbySoft Property Connector** - Property connector support for distribution partners that use DerbySoft for hotel content, rates, availability, and reservations.
- **Atomize** - Revenue and distribution adapter path for properties using Atomize pricing with connected channel operations.
- **Channex** - Modern channel manager API support for ARI, restrictions, mappings, and booking delivery.
- **Beds24** - Channel manager adapter for rates, inventory, availability, and booking import from Beds24-connected channels.
- **YieldPlanet** - Distribution connectivity for properties managing channel rates, availability, restrictions, and reservations through YieldPlanet.
- **D-EDGE** - Channel manager integration path for D-EDGE distribution, reservation delivery, and inventory updates.
- **Cubilis/Lighthouse** - Cubilis channel connectivity under Lighthouse for rate, availability, inventory, and booking workflows.
- **RateGain** - Channel management and distribution connectivity for RateGain-powered rate, inventory, and booking exchange.
- **HotelRunner** - HotelRunner channel manager support for inventory, rate updates, restrictions, and reservation import.
- **NextPax** - Vacation rental and lodging distribution connectivity for inventory, rates, availability, and reservations through NextPax.
- **Hotelbeds API Suite** - API suite connectivity for Hotelbeds content, availability, rates, and reservation workflows.
- **Amadeus Self-Service Hotel APIs** - Self-service hotel API connectivity for hotel search, offers, booking, and reference data use cases.

### OTA Direct Connectivity

- **Expedia Rapid** - Direct API connectivity for shopping, booking, itinerary retrieval, and reservation servicing through Expedia Rapid.
- **Vrbo on Rapid** - Vacation rental connectivity through Rapid-powered Vrbo shopping, booking, and reservation management flows.
- **Airbnb Partner API** - Partner API pathway for property content, availability, pricing, and reservation exchange with Airbnb.
- **Tripadvisor Instant Booking** - Instant Booking connectivity for availability, pricing, booking creation, and reservation delivery.
- **Trip.com Connect** - Trip.com connectivity for inventory, rates, availability, reservation delivery, and booking updates.

### Metasearch & Direct Booking

- **Pricepoint** - Direct booking and metasearch support for pricing, availability, and conversion-oriented reservation flows.
- **SHR/Windsurfer** - Booking engine and distribution connectivity for Windsurfer-powered direct reservation experiences.
- **Google Free Booking Links/Hotel Prices** - Google hotel price feed and free booking link support for direct booking discovery.
- **Google Hotel Content** - Hotel content feed support for property details, amenities, images, and metadata shown across Google travel surfaces.
- **Google Vacation Rentals** - Vacation rental feed support for property content, availability, pricing, and direct booking links.
- **trivago FastConnect** - FastConnect support for hotel rates, availability, landing pages, and booking referral flows.
- **trivago Conversion API** - Conversion reporting support for booking events attributed to trivago traffic.
- **TripAdvisor TripConnect** - TripConnect support for hotel rates, availability, booking links, and performance reporting.
- **KAYAK Hotels Search** - Hotel search feed support for availability, rates, deep links, and booking referral workflows.
- **Microsoft Advertising Hotel Ads** - Hotel ads feed support for rates, availability, landing pages, and campaign measurement.
- **Net Affinity** - Direct booking engine connectivity for availability, rates, reservations, and conversion workflows.

### Payments

- **Stripe** - Current card payment integration for tokenized payments, payment intents, refunds, and reconciliation-friendly transaction records.
- **Adyen** - Payment service provider adapter path for card tokenization, authorization, capture, refunds, and multi-market acquiring.
- **Square** - Payment and terminal connectivity for tokenized in-person and online payments, refunds, and transaction reconciliation.
- **Authorize.net** - Gateway connectivity for card authorization, capture, refund, and tokenized payment profiles.
- **PayPal/Braintree** - Wallet and card payment support through PayPal and Braintree payment flows.
- **Braintree standalone** - Braintree gateway support for tokenized card payments, vault records, captures, and refunds.
- **Mollie** - European payment method support for cards, local payment rails, refunds, and settlement-aware reporting.
- **SumUp** - In-person and small-business payment connectivity for terminal and transaction record workflows.
- **GoCardless** - Bank debit payment support for mandates, collections, refunds, and payment status updates.
- **Wise Platform** - Cross-border account and transfer support for payout and treasury workflows.
- **Revolut Merchant** - Merchant payment connectivity for card acceptance, refunds, and settlement reporting.
- **GoCardless Bank Payouts note** - Bank payout workflow reference for properties that separate guest collection from supplier or owner disbursement.

### Guest Messaging

- **HiJiffy** - Guest communication adapter for hotel chat, automation, and messaging workflows.
- **WhatsApp Cloud API** - WhatsApp Business messaging support for templates, session messages, delivery status, and guest conversations.
- **Viber Business** - Viber business messaging support for guest notifications, service messages, and operational communication.
- **Telegram Bot** - Telegram bot integration for guest messages, operational alerts, and simple automation commands.
- **Twilio Conversations/WhatsApp** - Omnichannel conversation support for SMS, WhatsApp, and agent-assisted guest messaging.
- **Vonage Messages** - Messaging API support for SMS, WhatsApp, Viber, and other guest communication channels.
- **Infobip Omnichannel** - Omnichannel messaging support for SMS, WhatsApp, Viber, email, and customer engagement workflows.
- **Bird** - Messaging platform connectivity for WhatsApp, SMS, email, and conversation routing.
- **Instagram Messaging** - Instagram direct message support for guest inquiries and service conversations.
- **Google RCS** - Rich messaging support for branded guest notifications and interactive service messages.
- **LINE** - LINE messaging support for guest communication in markets where LINE is a primary channel.
- **Sinch Conversation** - Conversation API support for SMS, WhatsApp, RCS, and other messaging channels.
- **Plivo** - SMS and voice messaging support for guest notifications and operational alerts.
- **Chatwoot** - Open-source inbox integration for guest messaging, team assignment, and conversation history.

### Email, Marketing & CRM

- **Mailchimp** - Marketing audience sync, campaign triggers, and guest lifecycle messaging support.
- **Brevo** - Email, SMS, and marketing automation support for guest communication and campaign workflows.
- **Cendyn** - Hotel CRM and marketing connectivity for guest profiles, campaign audiences, and engagement data.
- **HubSpot Free CRM** - CRM contact sync and activity capture for guest, company, and sales workflows.
- **ActiveCampaign** - Marketing automation support for guest segments, email journeys, and CRM activity.
- **Keap** - Small-business CRM and automation support for contacts, tags, campaigns, and follow-up tasks.
- **Zendesk** - Support desk integration for guest cases, service conversations, and ticket updates.
- **Odoo CRM** - CRM and ERP connectivity for leads, contacts, activities, and operational handoff.
- **Mailgun** - Transactional email support for confirmations, receipts, operational notices, and delivery tracking.
- **Postmark** - Transactional email delivery support with message streams, templates, and delivery events.
- **Mailjet** - Email delivery and marketing support for transactional messages, campaigns, and contact lists.
- **Amazon SES** - Scalable SMTP and API email delivery for confirmations, receipts, and operational notifications.
- **SendGrid** - Email API support for transactional templates, marketing lists, and delivery event webhooks.
- **Infobip Email & SMS** - Combined email and SMS communication support for guest notifications and campaigns.

### Reviews & Reputation

- **TrustYou** - Reputation management connectivity for review collection, sentiment, and guest feedback workflows.
- **TripAdvisor Content API** - Content API support for property information, reviews, and travel content display.
- **MARA AI** - Review response workflow support for AI-assisted drafting and reputation operations.
- **Google Business Profile Reviews** - Review retrieval and response workflow support for Google Business Profile listings.
- **Customer Alliance** - Guest feedback and reputation management connectivity for survey and review workflows.
- **Guest Suite** - Reputation and guest feedback support for review collection, surveys, and response workflows.
- **Google Places reviews field** - Places API review field support for displaying public review summaries and recent feedback.
- **Facebook Page Ratings** - Facebook page rating and review workflow support for social reputation monitoring.
- **Trustpilot** - Review invitation and review data connectivity for public reputation workflows.
- **Yotpo** - Review and loyalty platform connectivity for guest feedback and engagement use cases.
- **Foursquare Places** - Places data support for venue information, ratings, and location context.
- **ReviewTrackers** - Review monitoring and response workflow support across connected review sources.

### Upsells & Ancillaries

- **Duve** - Guest app and upsell connectivity for pre-arrival offers, service requests, and operational handoff.
- **Welcome Pickups** - Transfer booking support for airport rides, arrival details, and guest travel services.
- **BeSafe Rate** - Protected-rate and ancillary offer support for flexible booking and guest assurance products.
- **Oaky** - Upsell platform connectivity for room upgrades, add-ons, and targeted pre-arrival offers.
- **UpsellGuru** - Upgrade and ancillary bidding workflow support for pre-arrival revenue opportunities.
- **AKIN Travel** - Travel service connectivity for guest experience offers and trip planning workflows.
- **ViCo** - Ancillary and guest service adapter path for connected offer management.
- **Viator Partner API** - Tours and activities connectivity for inventory search, booking, and guest experience offers.
- **Revinate GDP** - Guest data platform connectivity for profiles, preferences, segmentation, and campaign activation.
- **Tremendous** - Digital reward and payout support for guest incentives, compensation, and service recovery workflows.
- **Blackhawk Network** - Gift card and reward distribution support for guest incentives and ancillary programs.
- **Rezdy** - Tours and activities booking connectivity for operators, availability, pricing, and reservations.
- **Xola** - Experiences booking support for tours, activities, availability, and reservation workflows.
- **Tiqets** - Attraction and ticketing connectivity for guest experience offers and booking flows.
- **ResortPass** - Day-use and amenity access connectivity for pools, spas, cabanas, and property experiences.

### Point of Sale

- **Epos Now** - POS connectivity for sales, items, payments, and posting charge summaries to guest folios.
- **MarketMan** - Restaurant inventory and purchasing connectivity for cost control, stock, and supplier workflows.
- **Square POS** - POS integration for in-person sales, catalog items, payments, and folio posting workflows.
- **Loyverse** - POS support for sales tickets, items, payments, and operational reporting.
- **Toast** - Restaurant POS connectivity for checks, tenders, menu items, and room charge workflows.
- **Clover** - POS support for orders, payments, devices, and charge posting to hotel accounts.
- **Generic Post Charge to Folio open pattern** - Open inbound pattern for POS systems that can send authenticated charge, tax, and payment details to a folio.
- **Erply** - Retail POS and inventory connectivity for sales, products, stock, and accounting handoff.
- **Shopify POS** - Retail POS connectivity for products, orders, payments, and guest or folio references.

### Accounting & ERP

- **QuickBooks Online** - Accounting sync for invoices, payments, deposits, customers, taxes, and revenue summaries.
- **Xero** - Accounting connectivity for contacts, invoices, payments, bank reconciliation, and tax reporting.
- **Sage Business Cloud** - Accounting integration for customer accounts, invoices, payments, and ledger exports.
- **Sage 50 CSV** - CSV export path for Sage 50 import workflows covering invoices, payments, and account mappings.
- **Bexio** - Swiss accounting connectivity for contacts, invoices, payments, and document workflows.
- **Holded** - Accounting and ERP support for invoices, contacts, payments, taxes, and operational exports.
- **Zoho Books** - Accounting sync for contacts, invoices, payments, taxes, and reporting data.
- **DATEV** - German accounting export support for bookkeeping, tax advisor handoff, and structured ledger data.
- **miniMAX** - Regional accounting connectivity for invoices, payments, tax records, and bookkeeping exports.
- **Exact Online** - ERP and accounting integration for financial entries, contacts, invoices, and payment records.

### Door Locks & Access

- **Salto KS** - Cloud access control support for issuing, updating, and revoking guest and staff access.
- **4SUITES** - Mobile key and access control connectivity for room access, access periods, and guest journeys.
- **Nuki** - Smart lock support for access grants, time windows, revocation, and operational status.
- **TTLock** - Smart lock API support for PINs, eKeys, access windows, and lock status workflows.
- **SwitchBot** - Device and lock connectivity for access automation, remote actions, and operational events.
- **HAIP LOCK_PROVIDER interface** - Provider interface for adding lock vendors behind a consistent access-control contract.

### ID Verification & Online Check-in

- **Straiv** - Online check-in support for guest forms, arrival data, identity capture, and guest messaging.
- **Samsotech VICAS** - Identity scanning and guest registration support for document capture and compliance workflows.
- **Civitfun** - Online check-in platform connectivity for guest data, upsells, payments, and digital arrival flows.
- **AdriaScan** - Document scanning support for passport, ID, and guest registration data capture.
- **Stripe Identity** - Identity verification support for document checks, selfie checks, and hosted verification sessions.
- **Veriff** - Identity verification support for document review, biometric checks, and verification decisions.
- **Serbia eTurista** - Guest registration pathway for Serbian accommodation reporting requirements.
- **Croatia eVisitor** - Guest registration pathway for Croatian tourist registration requirements.
- **Italy Alloggiati Web** - Guest registration pathway for Italian police accommodation reporting requirements.

### Revenue Management & Pricing

- **RoomPriceGenie** - Revenue management connectivity for recommended rates, pricing rules, and rate updates.
- **Pricepoint Developer API** - Pricing API support for rate recommendations, demand signals, and booking engine workflows.
- **Duetto** - Revenue strategy system connectivity for pricing recommendations, restrictions, and performance data.
- **IDeaS** - Revenue management integration path for forecasts, pricing recommendations, and inventory controls.
- **BEONX** - Revenue management support for demand intelligence, rate recommendations, and pricing workflows.
- **PriceLabs** - Dynamic pricing connectivity for short-term rental and hotel rates, minimum stays, and restrictions.
- **Beyond Pricing** - Dynamic pricing support for vacation rental and lodging rates, demand signals, and rate pushes.
- **DIAMO** - Revenue management connectivity for pricing recommendations and performance monitoring.
- **Lighthouse Market Data** - Market intelligence support for rate shopping, demand data, and pricing context.
- **123Compare.me** - Rate comparison and booking performance support for direct channel optimization.
- **Wheelhouse** - Dynamic pricing support for rental rates, demand insights, and calendar-based rate updates.

### Housekeeping & Operations

- **Flexkeeping** - Housekeeping and staff operations connectivity for tasks, room status, maintenance, and team communication.
- **Sweeply** - Housekeeping workflow support for room assignments, cleaning status, inspections, and maintenance tasks.
- **Quore** - Hotel operations integration for housekeeping, maintenance, requests, and property team workflows.
- **Trello** - Task board integration for operational checklists, room tasks, maintenance, and team assignments.
- **Notion** - Workspace integration for operational databases, checklists, knowledge pages, and task handoff.
- **Google Tasks** - Task creation and completion sync for staff reminders and operational follow-up.
- **Google Sheets** - Spreadsheet integration for exports, operational trackers, shared lists, and lightweight reporting.
- **Infobip Viber/SMS staff alerts** - Staff notification support through Viber and SMS for time-sensitive operational events.
- **Duve Housekeeping Task Sync** - Housekeeping task synchronization for guest requests, room readiness, and service follow-up.

### Automation Platforms

- **Zapier** - No-code automation support through webhooks and API actions for guest, reservation, and operational workflows.
- **Slack Incoming Webhooks** - Slack notification support for reservation events, operational alerts, and team updates.
- **n8n** - Open workflow automation support through webhooks, HTTP nodes, and API-key authenticated calls.
- **Pipedream** - Developer automation support for event-driven workflows, API calls, and custom code steps.
- **Make.com** - Scenario automation support through webhooks, HTTP modules, and connected app workflows.
- **IFTTT** - Simple automation support for trigger-action workflows connected to notifications and smart devices.
- **Discord Webhooks** - Discord notification support for operational channels, alerts, and team-visible event streams.
- **Microsoft Teams Workflows** - Teams workflow support for notifications, approvals, and operational automation.
- **Google Chat Incoming Webhooks** - Google Chat notification support for reservation events, alerts, and team spaces.
- **Home Assistant** - Smart property automation support through webhooks, sensors, scenes, and device actions.

### BI & Analytics

- **Looker Studio** - Reporting support through structured exports, database connections, and dashboard-ready datasets.
- **GA4 Measurement Protocol** - Analytics event support for booking funnel events, conversions, and server-side measurement.
- **GTM** - Tag management support for direct booking events, analytics routing, and marketing measurement.
- **Amadeus Demand360** - Market demand intelligence connectivity for forward-looking demand context and performance analysis.
- **Top-Report** - Hotel reporting connectivity for performance dashboards, exports, and management analytics.
- **Metabase** - Open-source BI support for PostgreSQL reporting, dashboards, and scheduled analytics.
- **Grafana** - Metrics and dashboard support for operations, system health, and business observability.
- **Redash** - SQL analytics support for dashboards, saved queries, and scheduled reporting.
- **Apache Superset** - Open-source analytics support for charts, dashboards, and governed SQL datasets.
- **Matomo** - Privacy-oriented web analytics support for direct booking behavior and conversion tracking.
- **Plausible** - Lightweight web analytics support for booking site traffic, goals, and referral reporting.
- **Umami** - Open-source web analytics support for privacy-friendly traffic and conversion measurement.

### Fiscalization & Tax Compliance (worldwide)

- **Serbia SUF/ESIR** - Fiscal device and receipt workflow support for Serbian fiscalization requirements.
- **Croatia Fiskalizacija 2.0** - Fiscal receipt and e-invoicing workflow support for Croatian fiscalization requirements.
- **Slovenia FURS** - Fiscal receipt reporting support for Slovenian tax authority requirements.
- **fiskaly SIGN DE** - German TSE signing support for compliant receipt signing and audit data workflows.
- **fiskaly SIGN AT** - Austrian RKSV signing support for compliant receipt signing and fiscal records.
- **VIES** - EU VAT number validation support for business guest and invoicing workflows.
- **NBS exchange rates** - Serbian central bank exchange rate support for currency conversion and reporting.
- **North Macedonia e-Faktura** - E-invoicing workflow support for North Macedonian fiscal documentation.
- **BiH fiscalization** - Fiscal receipt workflow support for Bosnia and Herzegovina fiscalization requirements.
- **Montenegro Fiskalizacija** - Fiscal receipt reporting support for Montenegrin fiscalization requirements.
- **Belgium Peppol B2B** - Peppol e-invoicing support for Belgian business-to-business invoice exchange.
- **Luxembourg Peppol upcoming** - Peppol e-invoicing pathway for Luxembourg business invoice exchange as mandates evolve.
- **Ireland VAT Modernisation** - VAT reporting support for Irish digital VAT compliance workflows.
- **UK MTD VAT** - Making Tax Digital VAT support for return preparation and submission workflows.
- **Swiss QR-bill** - QR-bill payment reference support for Swiss invoicing and bank payment workflows.
- **Italy SDI** - E-invoicing support for Italian Sistema di Interscambio invoice exchange.
- **Italy Alloggiati** - Italian accommodation reporting pathway included with public compliance coverage.
- **Spain VeriFactu** - Verifiable invoice record support for Spanish anti-fraud invoicing requirements.
- **TicketBAI** - Basque Country invoice reporting support for TicketBAI fiscal requirements.
- **SII** - Spanish Immediate Supply of Information VAT reporting workflow support.
- **SES.Hospedajes** - Spanish guest and lodging registration reporting pathway for hospitality obligations.
- **Greece myDATA** - E-books and invoice classification workflow support for Greek AADE myDATA requirements.
- **Estonia e-invoicing** - Structured e-invoicing support for Estonian public and business invoice exchange.
- **Latvia VID** - Tax authority reporting pathway for Latvian fiscal and invoice workflows.
- **Poland KSeF** - National e-invoicing support for Polish structured invoice exchange.
- **Hungary NAV 3.0** - Real-time invoice data reporting support for Hungarian NAV requirements.
- **Hungary NTAK** - Accommodation data reporting pathway for Hungarian tourism reporting requirements.
- **Romania RO e-Factura** - E-invoicing support for Romanian RO e-Factura invoice exchange.
- **Mexico CFDI** - Electronic invoice workflow support for Mexican CFDI fiscal documents.
- **El Salvador DTE** - Electronic tax document workflow support for Salvadoran DTE requirements.
- **Colombia DIAN** - Electronic invoicing support for Colombian DIAN fiscal document requirements.
- **Ecuador SRI** - Electronic receipt and invoice workflow support for Ecuadorian SRI requirements.

### Government Guest Registration (worldwide)

- **Luxembourg fiches d'hébergement** - Guest registration pathway for Luxembourg accommodation record requirements.
- **Portugal SIBA** - Guest accommodation reporting pathway for Portuguese border and immigration requirements.
- **Greece Ξένιος Ζευς** - Guest registration pathway for Greek accommodation reporting requirements.
- **Andorra ROAT** - Accommodation registration pathway for Andorran tourism and lodging reporting requirements.
- **Czechia Ubyport** - Guest reporting pathway for Czech foreign police accommodation registration requirements.
- **Sweden Polisen hotel registration** - Guest registration workflow support for Swedish police hotel record requirements.
- **Finland Matkustajailmoitus** - Traveller notification workflow support for Finnish accommodation registration requirements.
- **Uruguay RIHP** - Guest and lodging registration pathway for Uruguayan hospitality reporting requirements.
- **Costa Rica ICT non-traditional lodging registration** - Registration pathway for Costa Rican non-traditional lodging obligations.

### Open Standards & Infrastructure

- **Slack webhooks/API** - Team notification and workflow support through Slack webhooks and API calls.
- **Outlook/Graph Calendar** - Calendar sync support for Outlook and Microsoft Graph availability, events, and operational schedules.
- **Google Drive** - Document storage support for exports, receipts, reports, and shared operational files.
- **Airtable** - Lightweight database integration for operational trackers, custom workflows, and structured exports.
- **iCal Import/Export** - Calendar standard support for availability import, availability export, and channel calendar bridging.
- **Frankfurter/ECB FX** - Foreign exchange rate support based on European Central Bank reference data.
- **exchangerate.host** - Exchange rate API support for currency conversion, reporting, and display workflows.
- **Documenso** - Open-source e-signature support for contracts, forms, and guest documents.
- **Dropbox Sign** - E-signature workflow support for agreements, authorizations, and operational documents.
- **Open-Meteo** - Weather data support for guest experience, operations planning, and local information displays.
- **OSM Nominatim** - OpenStreetMap geocoding support for addresses, local search, and location normalization.
- **UniFi Guest Hotspot** - Guest Wi-Fi access support for UniFi hotspot authorization and operational workflows.
- **OpenTravel/HTNG XML** - Hospitality XML standard support for distribution, reservations, profiles, and operational interoperability.

### Compliance market entry (paid/gated)

Paid hardware-cert routes and feature-only guest registers are **not** free marketplace connectors. See [Compliance market entry](integrations/compliance-market-entry.md). Schedule by market entry; never marketed as free automated filing.

Want an integration that isn't listed? HAIP is open source - open an issue, or build against the API at `/docs`.
