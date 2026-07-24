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
    status: 'shipped',
    docsPath: 'docs/INTEGRATIONS.md#channel-managers',
    adapterKey: 'siteminder',
    description:
      'Channel manager connectivity for rates, availability, restrictions, reservations, and inventory updates through SiteMinder.',
  },
  {
    slug: 'derbysoft-property-connector',
    category: 'Channel Managers',
    name: 'DerbySoft Property Connector',
    status: 'shipped',
    docsPath: 'docs/INTEGRATIONS.md#channel-managers',
    adapterKey: 'derbysoft',
    description:
      'Property connector support for hotel content, rates, availability, and reservations through DerbySoft.',
  },
  {
    slug: 'beds24',
    category: 'Channel Managers',
    name: 'Beds24',
    status: 'shipped',
    docsPath: 'docs/integrations/channel-beds24-channex.md',
    adapterKey: 'beds24',
    description:
      'Channel manager adapter for rates, inventory, availability, and booking import from Beds24-connected channels.',
  },
  {
    slug: 'channex',
    category: 'Channel Managers',
    name: 'Channex',
    status: 'shipped',
    docsPath: 'docs/integrations/channel-beds24-channex.md',
    adapterKey: 'channex',
    description:
      'Modern channel manager API support for ARI, restrictions, mappings, and booking delivery.',
  },
  {
    slug: 'expedia-eqc',
    category: 'Channel Managers',
    name: 'Expedia EQC',
    status: 'adapter',
    docsPath: 'docs/integrations/wave3-channels-wise.md',
    adapterKey: 'expedia_eqc',
    description:
      'Expedia QuickConnect-style channel connectivity for availability, rates, booking delivery, and reservation lifecycle updates.',
  },
  {
    slug: 'myallocator-cloudbeds',
    category: 'Channel Managers',
    name: 'Myallocator/Cloudbeds',
    status: 'adapter',
    docsPath: 'docs/integrations/wave3-channels-wise.md',
    adapterKey: 'myallocator_cloudbeds',
    description:
      'Cloudbeds channel manager connectivity for property inventory, rate plans, and reservation synchronization.',
  },
  {
    slug: 'atomize',
    category: 'Channel Managers',
    name: 'Atomize',
    status: 'adapter',
    docsPath: 'docs/integrations/wave3-channels-wise.md',
    adapterKey: 'atomize',
    description:
      'Revenue and distribution adapter path for properties using Atomize pricing with connected channel operations.',
  },
  {
    slug: 'yieldplanet',
    category: 'Channel Managers',
    name: 'YieldPlanet',
    status: 'adapter',
    docsPath: 'docs/integrations/wave3-channels-wise.md',
    adapterKey: 'yieldplanet',
    description:
      'Distribution connectivity for channel rates, availability, restrictions, and reservations through YieldPlanet.',
  },
  {
    slug: 'd-edge',
    category: 'Channel Managers',
    name: 'D-EDGE',
    status: 'adapter',
    docsPath: 'docs/integrations/wave3-channels-wise.md',
    adapterKey: 'd_edge',
    description:
      'Channel manager integration path for D-EDGE distribution, reservation delivery, and inventory updates.',
  },
  {
    slug: 'cubilis-lighthouse',
    category: 'Channel Managers',
    name: 'Cubilis/Lighthouse',
    status: 'adapter',
    docsPath: 'docs/integrations/wave3-channels-wise.md',
    adapterKey: 'cubilis_lighthouse',
    description:
      'Cubilis channel connectivity under Lighthouse for rate, availability, inventory, and booking workflows.',
  },
  {
    slug: 'rategain',
    category: 'Channel Managers',
    name: 'RateGain',
    status: 'adapter',
    docsPath: 'docs/integrations/wave3-channels-wise.md',
    adapterKey: 'rategain',
    description:
      'Channel management and distribution connectivity for RateGain-powered rate, inventory, and booking exchange.',
  },
  {
    slug: 'hotelrunner',
    category: 'Channel Managers',
    name: 'HotelRunner',
    status: 'adapter',
    docsPath: 'docs/integrations/wave3-channels-wise.md',
    adapterKey: 'hotelrunner',
    description:
      'HotelRunner channel manager support for inventory, rate updates, restrictions, and reservation import.',
  },
  {
    slug: 'nextpax',
    category: 'Channel Managers',
    name: 'NextPax',
    status: 'adapter',
    docsPath: 'docs/integrations/wave3-channels-wise.md',
    adapterKey: 'nextpax',
    description:
      'Vacation rental and lodging distribution connectivity for inventory, rates, availability, and reservations through NextPax.',
  },
  {
    slug: 'hotelbeds-api-suite',
    category: 'Channel Managers',
    name: 'Hotelbeds API Suite',
    status: 'adapter',
    docsPath: 'docs/integrations/wave3-channels-wise.md',
    adapterKey: 'hotelbeds',
    description:
      'API suite connectivity for Hotelbeds content, availability, rates, and reservation workflows.',
  },
  {
    slug: 'amadeus-self-service-hotel-apis',
    category: 'Channel Managers',
    name: 'Amadeus Self-Service Hotel APIs',
    status: 'adapter',
    docsPath: 'docs/integrations/wave3-channels-wise.md',
    adapterKey: 'amadeus_hotel',
    description:
      'Self-service hotel API connectivity for hotel search, offers, booking, and reference data use cases.',
  },
  {
    slug: 'channel-manager-cert-queue',
    category: 'Channel Managers',
    name: 'Channel manager partner certification queue',
    status: 'planned',
    docsPath: 'docs/integrations/wave3-partner-surface.md',
    adapterKey: null,
    description:
      'Partner application and certification queue surface for additional channel-manager connectivity beyond current adapters.',
  },
  {
    slug: 'channel-manager-mapping-studio',
    category: 'Channel Managers',
    name: 'Channel mapping studio (partner)',
    status: 'planned',
    docsPath: 'docs/integrations/wave3-partner-surface.md',
    adapterKey: null,
    description:
      'Partner-facing room/rate mapping studio surface required by multi-channel certification onboarding.',
  },
  {
    slug: 'expedia-rapid',
    category: 'OTA Direct Connectivity',
    name: 'Expedia Rapid',
    status: 'planned',
    docsPath: 'docs/integrations/wave3-partner-surface.md',
    adapterKey: null,
    description:
      'Direct API connectivity for shopping, booking, itinerary retrieval, and reservation servicing through Expedia Rapid.',
  },
  {
    slug: 'vrbo-on-rapid',
    category: 'OTA Direct Connectivity',
    name: 'Vrbo on Rapid',
    status: 'planned',
    docsPath: 'docs/integrations/wave3-partner-surface.md',
    adapterKey: null,
    description:
      'Vacation rental connectivity through Rapid-powered Vrbo shopping, booking, and reservation management flows.',
  },
  {
    slug: 'airbnb-partner-api',
    category: 'OTA Direct Connectivity',
    name: 'Airbnb Partner API',
    status: 'planned',
    docsPath: 'docs/integrations/wave3-partner-surface.md',
    adapterKey: null,
    description:
      'Partner API pathway for property content, availability, pricing, and reservation exchange with Airbnb.',
  },
  {
    slug: 'tripadvisor-instant-booking',
    category: 'OTA Direct Connectivity',
    name: 'Tripadvisor Instant Booking',
    status: 'planned',
    docsPath: 'docs/integrations/wave3-partner-surface.md',
    adapterKey: null,
    description:
      'Instant Booking connectivity for availability, pricing, booking creation, and reservation delivery.',
  },
  {
    slug: 'trip-com-connect',
    category: 'OTA Direct Connectivity',
    name: 'Trip.com Connect',
    status: 'planned',
    docsPath: 'docs/integrations/wave3-partner-surface.md',
    adapterKey: null,
    description:
      'Trip.com connectivity for inventory, rates, availability, reservation delivery, and booking updates.',
  },
  {
    slug: 'google-hotel-prices',
    category: 'Metasearch & Direct Booking',
    name: 'Google Free Booking Links/Hotel Prices',
    status: 'planned',
    docsPath: 'docs/integrations/wave3-partner-surface.md',
    adapterKey: null,
    description:
      'Google hotel price feed and free booking link support for direct booking discovery.',
  },
  {
    slug: 'google-hotel-content',
    category: 'Metasearch & Direct Booking',
    name: 'Google Hotel Content',
    status: 'planned',
    docsPath: 'docs/integrations/wave3-partner-surface.md',
    adapterKey: null,
    description:
      'Hotel content feed support for property details, amenities, images, and metadata shown across Google travel surfaces.',
  },
  {
    slug: 'google-vacation-rentals',
    category: 'Metasearch & Direct Booking',
    name: 'Google Vacation Rentals',
    status: 'planned',
    docsPath: 'docs/integrations/wave3-partner-surface.md',
    adapterKey: null,
    description:
      'Vacation rental feed support for property content, availability, pricing, and direct booking links.',
  },
  {
    slug: 'trivago-fastconnect',
    category: 'Metasearch & Direct Booking',
    name: 'trivago FastConnect',
    status: 'planned',
    docsPath: 'docs/integrations/wave3-partner-surface.md',
    adapterKey: null,
    description:
      'FastConnect support for hotel rates, availability, landing pages, and booking referral flows.',
  },
  {
    slug: 'trivago-conversion-api',
    category: 'Metasearch & Direct Booking',
    name: 'trivago Conversion API',
    status: 'planned',
    docsPath: 'docs/integrations/wave3-partner-surface.md',
    adapterKey: null,
    description:
      'Conversion reporting support for booking events attributed to trivago traffic.',
  },
  {
    slug: 'tripadvisor-tripconnect',
    category: 'Metasearch & Direct Booking',
    name: 'TripAdvisor TripConnect',
    status: 'planned',
    docsPath: 'docs/integrations/wave3-partner-surface.md',
    adapterKey: null,
    description:
      'TripConnect support for hotel rates, availability, booking links, and performance reporting.',
  },
  {
    slug: 'kayak-hotels-search',
    category: 'Metasearch & Direct Booking',
    name: 'KAYAK Hotels Search',
    status: 'planned',
    docsPath: 'docs/integrations/wave3-partner-surface.md',
    adapterKey: null,
    description:
      'Hotel search feed support for availability, rates, deep links, and booking referral workflows.',
  },
  {
    slug: 'microsoft-advertising-hotel-ads',
    category: 'Metasearch & Direct Booking',
    name: 'Microsoft Advertising Hotel Ads',
    status: 'planned',
    docsPath: 'docs/integrations/wave3-partner-surface.md',
    adapterKey: null,
    description:
      'Hotel ads feed support for rates, availability, landing pages, and campaign measurement.',
  },
  {
    slug: 'pricepoint',
    category: 'Metasearch & Direct Booking',
    name: 'Pricepoint',
    status: 'planned',
    docsPath: 'docs/integrations/wave3-partner-surface.md',
    adapterKey: null,
    description:
      'Direct booking and metasearch support for pricing, availability, and conversion-oriented reservation flows.',
  },
  {
    slug: 'shr-windsurfer',
    category: 'Metasearch & Direct Booking',
    name: 'SHR/Windsurfer',
    status: 'planned',
    docsPath: 'docs/integrations/wave3-partner-surface.md',
    adapterKey: null,
    description:
      'Booking engine and distribution connectivity for Windsurfer-powered direct reservation experiences.',
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
    status: 'shipped',
    docsPath: 'docs/integrations/payments-adyen-mollie-square-braintree.md',
    adapterKey: 'adyen',
    description:
      'Payment service provider adapter path for tokenization, authorization, capture, refunds, and acquiring.',
  },
  {
    slug: 'mollie',
    category: 'Payments',
    name: 'Mollie',
    status: 'shipped',
    docsPath: 'docs/integrations/payments-adyen-mollie-square-braintree.md',
    adapterKey: 'mollie',
    description:
      'European payment method support for cards, local payment rails, refunds, and settlement-aware reporting.',
  },
  {
    slug: 'square',
    category: 'Payments',
    name: 'Square',
    status: 'shipped',
    docsPath: 'docs/integrations/payments-adyen-mollie-square-braintree.md',
    adapterKey: 'square',
    description:
      'Payment and terminal connectivity for tokenized in-person and online payments, refunds, and reconciliation.',
  },
  {
    slug: 'braintree',
    category: 'Payments',
    name: 'Braintree standalone',
    status: 'shipped',
    docsPath: 'docs/integrations/payments-adyen-mollie-square-braintree.md',
    adapterKey: 'braintree',
    description:
      'Braintree gateway support for tokenized card payments, vault records, captures, and refunds.',
  },
  {
    slug: 'wise-platform',
    category: 'Payments',
    name: 'Wise Platform',
    status: 'adapter',
    docsPath: 'docs/integrations/wave3-channels-wise.md',
    adapterKey: 'wise',
    description:
      'Cross-border account and transfer support for payout and treasury workflows (partner platform).',
  },
  {
    slug: 'infobip-omnichannel',
    category: 'Guest Messaging',
    name: 'Infobip Omnichannel',
    status: 'shipped',
    docsPath: 'docs/integrations/messaging-infobip-vonage-telegram.md',
    adapterKey: 'infobip',
    description:
      'Omnichannel messaging support for SMS and guest engagement workflows.',
  },
  {
    slug: 'vonage-messages',
    category: 'Guest Messaging',
    name: 'Vonage Messages',
    status: 'shipped',
    docsPath: 'docs/integrations/messaging-infobip-vonage-telegram.md',
    adapterKey: 'vonage',
    description:
      'Messaging API support for SMS and other guest communication channels.',
  },
  {
    slug: 'telegram-bot',
    category: 'Guest Messaging',
    name: 'Telegram Bot',
    status: 'shipped',
    docsPath: 'docs/integrations/messaging-infobip-vonage-telegram.md',
    adapterKey: 'telegram',
    description:
      'Telegram bot integration for guest messages, operational alerts, and simple automation commands.',
  },
  {
    slug: 'bird',
    category: 'Guest Messaging',
    name: 'Bird',
    status: 'shipped',
    docsPath: 'docs/integrations/bird-sms.md',
    adapterKey: 'bird',
    description:
      'Messaging platform connectivity for WhatsApp, SMS, email, and conversation routing.',
  },
  {
    slug: 'whatsapp-cloud-api',
    category: 'Guest Messaging',
    name: 'WhatsApp Cloud API',
    status: 'shipped',
    docsPath: 'docs/integrations/whatsapp-cloud.md',
    adapterKey: 'whatsapp-cloud',
    description:
      'WhatsApp Business messaging support for templates, session messages, delivery status, and guest conversations.',
  },
  {
    slug: 'viber-business',
    category: 'Guest Messaging',
    name: 'Viber Business',
    status: 'planned',
    docsPath: 'docs/integrations/wave3-partner-surface.md',
    adapterKey: null,
    description:
      'Viber business messaging support for guest notifications, service messages, and operational communication.',
  },
  {
    slug: 'hijiffy',
    category: 'Guest Messaging',
    name: 'HiJiffy',
    status: 'planned',
    docsPath: 'docs/integrations/wave3-partner-surface.md',
    adapterKey: null,
    description:
      'Guest communication adapter for hotel chat, automation, and messaging workflows.',
  },
  {
    slug: 'instagram-messaging',
    category: 'Guest Messaging',
    name: 'Instagram Messaging',
    status: 'planned',
    docsPath: 'docs/integrations/wave3-partner-surface.md',
    adapterKey: null,
    description:
      'Instagram direct message support for guest inquiries and service conversations.',
  },
  {
    slug: 'google-rcs',
    category: 'Guest Messaging',
    name: 'Google RCS',
    status: 'planned',
    docsPath: 'docs/integrations/wave3-partner-surface.md',
    adapterKey: null,
    description:
      'Rich messaging support for branded guest notifications and interactive service messages.',
  },
  {
    slug: 'line-messaging',
    category: 'Guest Messaging',
    name: 'LINE',
    status: 'planned',
    docsPath: 'docs/integrations/wave3-partner-surface.md',
    adapterKey: null,
    description:
      'LINE messaging support for guest communication in markets where LINE is a primary channel.',
  },
  {
    slug: 'sinch-conversation',
    category: 'Guest Messaging',
    name: 'Sinch Conversation',
    status: 'planned',
    docsPath: 'docs/integrations/wave3-partner-surface.md',
    adapterKey: null,
    description:
      'Conversation API support for SMS, WhatsApp, RCS, and other messaging channels.',
  },
  {
    slug: 'chatwoot',
    category: 'Guest Messaging',
    name: 'Chatwoot',
    status: 'planned',
    docsPath: 'docs/integrations/wave3-partner-surface.md',
    adapterKey: null,
    description:
      'Open-source inbox integration for guest messaging, team assignment, and conversation history.',
  },
  {
    slug: 'twilio-conversations-whatsapp',
    category: 'Guest Messaging',
    name: 'Twilio Conversations/WhatsApp',
    status: 'planned',
    docsPath: 'docs/integrations/wave3-partner-surface.md',
    adapterKey: null,
    description:
      'Omnichannel conversation support for SMS, WhatsApp, and agent-assisted guest messaging.',
  },
  {
    slug: 'sendgrid',
    category: 'Email, Marketing & CRM',
    name: 'SendGrid',
    status: 'shipped',
    docsPath: 'docs/integrations/sendgrid-email.md',
    adapterKey: 'sendgrid',
    description:
      'Email API support for transactional templates, marketing lists, and delivery event webhooks.',
  },
  {
    slug: 'mailchimp',
    category: 'Email, Marketing & CRM',
    name: 'Mailchimp',
    status: 'planned',
    docsPath: 'docs/integrations/wave3-partner-surface.md',
    adapterKey: null,
    description:
      'Marketing audience sync, campaign triggers, and guest lifecycle messaging support.',
  },
  {
    slug: 'hubspot-free-crm',
    category: 'Email, Marketing & CRM',
    name: 'HubSpot Free CRM',
    status: 'planned',
    docsPath: 'docs/integrations/wave3-partner-surface.md',
    adapterKey: null,
    description:
      'CRM contact sync and activity capture for guest, company, and sales workflows.',
  },
  {
    slug: 'activecampaign',
    category: 'Email, Marketing & CRM',
    name: 'ActiveCampaign',
    status: 'planned',
    docsPath: 'docs/integrations/wave3-partner-surface.md',
    adapterKey: null,
    description:
      'Marketing automation support for guest segments, email journeys, and CRM activity.',
  },
  {
    slug: 'zendesk',
    category: 'Email, Marketing & CRM',
    name: 'Zendesk',
    status: 'planned',
    docsPath: 'docs/integrations/wave3-partner-surface.md',
    adapterKey: null,
    description:
      'Support desk integration for guest cases, service conversations, and ticket updates.',
  },
  {
    slug: 'cendyn',
    category: 'Email, Marketing & CRM',
    name: 'Cendyn',
    status: 'planned',
    docsPath: 'docs/integrations/wave3-partner-surface.md',
    adapterKey: null,
    description:
      'Hotel CRM and marketing connectivity for guest profiles, campaign audiences, and engagement data.',
  },
  {
    slug: 'brevo',
    category: 'Email, Marketing & CRM',
    name: 'Brevo',
    status: 'planned',
    docsPath: 'docs/integrations/wave3-partner-surface.md',
    adapterKey: null,
    description:
      'Email, SMS, and marketing automation support for guest communication and campaign workflows.',
  },
  {
    slug: 'keap',
    category: 'Email, Marketing & CRM',
    name: 'Keap',
    status: 'planned',
    docsPath: 'docs/integrations/wave3-partner-surface.md',
    adapterKey: null,
    description:
      'Small-business CRM and automation support for contacts, tags, campaigns, and follow-up tasks.',
  },
  {
    slug: 'mailgun',
    category: 'Email, Marketing & CRM',
    name: 'Mailgun',
    status: 'shipped',
    docsPath: 'docs/integrations/mailgun-ses.md',
    adapterKey: 'mailgun',
    description:
      'Transactional email support for confirmations, receipts, operational notices, and delivery tracking.',
  },
  {
    slug: 'amazon-ses',
    category: 'Email, Marketing & CRM',
    name: 'Amazon SES',
    status: 'shipped',
    docsPath: 'docs/integrations/mailgun-ses.md',
    adapterKey: 'amazon-ses',
    description:
      'Scalable SMTP and API email delivery for confirmations, receipts, and operational notifications.',
  },
  {
    slug: 'google-business-profile-reviews',
    category: 'Reviews & Reputation',
    name: 'Google Business Profile Reviews',
    status: 'shipped',
    docsPath: 'docs/integrations/review-sources.md',
    adapterKey: 'google',
    description:
      'Review retrieval and response workflow support for Google Business Profile listings.',
  },
  {
    slug: 'tripadvisor-content-api',
    category: 'Reviews & Reputation',
    name: 'TripAdvisor Content API',
    status: 'shipped',
    docsPath: 'docs/integrations/review-sources.md',
    adapterKey: 'tripadvisor',
    description:
      'Content API support for property information, reviews, and travel content display.',
  },
  {
    slug: 'trustyou',
    category: 'Reviews & Reputation',
    name: 'TrustYou',
    status: 'planned',
    docsPath: 'docs/integrations/wave3-partner-surface.md',
    adapterKey: null,
    description:
      'Reputation management connectivity for review collection, sentiment, and guest feedback workflows.',
  },
  {
    slug: 'customer-alliance',
    category: 'Reviews & Reputation',
    name: 'Customer Alliance',
    status: 'planned',
    docsPath: 'docs/integrations/wave3-partner-surface.md',
    adapterKey: null,
    description:
      'Guest feedback and reputation management connectivity for survey and review workflows.',
  },
  {
    slug: 'trustpilot',
    category: 'Reviews & Reputation',
    name: 'Trustpilot',
    status: 'planned',
    docsPath: 'docs/integrations/wave3-partner-surface.md',
    adapterKey: null,
    description:
      'Review invitation and review data connectivity for public reputation workflows.',
  },
  {
    slug: 'yotpo',
    category: 'Reviews & Reputation',
    name: 'Yotpo',
    status: 'planned',
    docsPath: 'docs/integrations/wave3-partner-surface.md',
    adapterKey: null,
    description:
      'Review and loyalty platform connectivity for guest feedback and engagement use cases.',
  },
  {
    slug: 'mara-ai',
    category: 'Reviews & Reputation',
    name: 'MARA AI',
    status: 'planned',
    docsPath: 'docs/integrations/wave3-partner-surface.md',
    adapterKey: null,
    description:
      'Review response workflow support for AI-assisted drafting and reputation operations.',
  },
  {
    slug: 'guest-suite',
    category: 'Reviews & Reputation',
    name: 'Guest Suite',
    status: 'planned',
    docsPath: 'docs/integrations/wave3-partner-surface.md',
    adapterKey: null,
    description:
      'Reputation and guest feedback support for review collection, surveys, and response workflows.',
  },
  {
    slug: 'facebook-page-ratings',
    category: 'Reviews & Reputation',
    name: 'Facebook Page Ratings',
    status: 'planned',
    docsPath: 'docs/integrations/wave3-partner-surface.md',
    adapterKey: null,
    description:
      'Facebook page rating and review workflow support for social reputation monitoring.',
  },
  {
    slug: 'reviewtrackers',
    category: 'Reviews & Reputation',
    name: 'ReviewTrackers',
    status: 'planned',
    docsPath: 'docs/integrations/wave3-partner-surface.md',
    adapterKey: null,
    description:
      'Review monitoring and response workflow support across connected review sources.',
  },
  {
    slug: 'foursquare-places',
    category: 'Reviews & Reputation',
    name: 'Foursquare Places',
    status: 'planned',
    docsPath: 'docs/integrations/wave3-partner-surface.md',
    adapterKey: null,
    description:
      'Places data support for venue information, ratings, and location context.',
  },
  {
    slug: 'duve',
    category: 'Upsells & Ancillaries',
    name: 'Duve',
    status: 'planned',
    docsPath: 'docs/integrations/wave3-partner-surface.md',
    adapterKey: null,
    description:
      'Guest app and upsell connectivity for pre-arrival offers, service requests, and operational handoff.',
  },
  {
    slug: 'oaky',
    category: 'Upsells & Ancillaries',
    name: 'Oaky',
    status: 'planned',
    docsPath: 'docs/integrations/wave3-partner-surface.md',
    adapterKey: null,
    description:
      'Upsell platform connectivity for room upgrades, add-ons, and targeted pre-arrival offers.',
  },
  {
    slug: 'upsellguru',
    category: 'Upsells & Ancillaries',
    name: 'UpsellGuru',
    status: 'planned',
    docsPath: 'docs/integrations/wave3-partner-surface.md',
    adapterKey: null,
    description:
      'Upgrade and ancillary bidding workflow support for pre-arrival revenue opportunities.',
  },
  {
    slug: 'rezdy',
    category: 'Upsells & Ancillaries',
    name: 'Rezdy',
    status: 'planned',
    docsPath: 'docs/integrations/wave3-partner-surface.md',
    adapterKey: null,
    description:
      'Tours and activities booking connectivity for operators, availability, pricing, and reservations.',
  },
  {
    slug: 'xola',
    category: 'Upsells & Ancillaries',
    name: 'Xola',
    status: 'planned',
    docsPath: 'docs/integrations/wave3-partner-surface.md',
    adapterKey: null,
    description:
      'Experiences booking support for tours, activities, availability, and reservation workflows.',
  },
  {
    slug: 'tiqets',
    category: 'Upsells & Ancillaries',
    name: 'Tiqets',
    status: 'planned',
    docsPath: 'docs/integrations/wave3-partner-surface.md',
    adapterKey: null,
    description:
      'Attraction and ticketing connectivity for guest experience offers and booking flows.',
  },
  {
    slug: 'welcome-pickups',
    category: 'Upsells & Ancillaries',
    name: 'Welcome Pickups',
    status: 'planned',
    docsPath: 'docs/integrations/wave3-partner-surface.md',
    adapterKey: null,
    description:
      'Transfer booking support for airport rides, arrival details, and guest travel services.',
  },
  {
    slug: 'besafe-rate',
    category: 'Upsells & Ancillaries',
    name: 'BeSafe Rate',
    status: 'planned',
    docsPath: 'docs/integrations/wave3-partner-surface.md',
    adapterKey: null,
    description:
      'Protected-rate and ancillary offer support for flexible booking and guest assurance products.',
  },
  {
    slug: 'viator-partner-api',
    category: 'Upsells & Ancillaries',
    name: 'Viator Partner API',
    status: 'planned',
    docsPath: 'docs/integrations/wave3-partner-surface.md',
    adapterKey: null,
    description:
      'Tours and activities connectivity for inventory search, booking, and guest experience offers.',
  },
  {
    slug: 'tremendous',
    category: 'Upsells & Ancillaries',
    name: 'Tremendous',
    status: 'planned',
    docsPath: 'docs/integrations/wave3-partner-surface.md',
    adapterKey: null,
    description:
      'Digital reward and payout support for guest incentives, compensation, and service recovery workflows.',
  },
  {
    slug: 'blackhawk-network',
    category: 'Upsells & Ancillaries',
    name: 'Blackhawk Network',
    status: 'planned',
    docsPath: 'docs/integrations/wave3-partner-surface.md',
    adapterKey: null,
    description:
      'Gift card and reward distribution support for guest incentives and ancillary programs.',
  },
  {
    slug: 'resortpass',
    category: 'Upsells & Ancillaries',
    name: 'ResortPass',
    status: 'planned',
    docsPath: 'docs/integrations/wave3-partner-surface.md',
    adapterKey: null,
    description:
      'Day-use and amenity access connectivity for pools, spas, cabanas, and property experiences.',
  },
  {
    slug: 'generic-post-charge-to-folio-open-pattern',
    category: 'Point of Sale',
    name: 'Generic Post Charge to Folio open pattern',
    status: 'recipe',
    docsPath: 'docs/integrations/folio-inbound-pos.md',
    adapterKey: null,
    description:
      'Open inbound pattern for POS systems that can send authenticated charge, tax, and payment details to a folio.',
  },
  {
    slug: 'square-pos',
    category: 'Point of Sale',
    name: 'Square POS',
    status: 'planned',
    docsPath: 'docs/integrations/wave3-partner-surface.md',
    adapterKey: null,
    description:
      'POS integration for in-person sales, catalog items, payments, and folio posting workflows.',
  },
  {
    slug: 'toast',
    category: 'Point of Sale',
    name: 'Toast',
    status: 'planned',
    docsPath: 'docs/integrations/wave3-partner-surface.md',
    adapterKey: null,
    description:
      'Restaurant POS connectivity for checks, tenders, menu items, and room charge workflows.',
  },
  {
    slug: 'clover',
    category: 'Point of Sale',
    name: 'Clover',
    status: 'planned',
    docsPath: 'docs/integrations/wave3-partner-surface.md',
    adapterKey: null,
    description:
      'POS support for orders, payments, devices, and charge posting to hotel accounts.',
  },
  {
    slug: 'epos-now',
    category: 'Point of Sale',
    name: 'Epos Now',
    status: 'planned',
    docsPath: 'docs/integrations/wave3-partner-surface.md',
    adapterKey: null,
    description:
      'POS connectivity for sales, items, payments, and posting charge summaries to guest folios.',
  },
  {
    slug: 'shopify-pos',
    category: 'Point of Sale',
    name: 'Shopify POS',
    status: 'planned',
    docsPath: 'docs/integrations/wave3-partner-surface.md',
    adapterKey: null,
    description:
      'Retail POS connectivity for products, orders, payments, and guest or folio references.',
  },
  {
    slug: 'loyverse',
    category: 'Point of Sale',
    name: 'Loyverse',
    status: 'planned',
    docsPath: 'docs/integrations/wave3-partner-surface.md',
    adapterKey: null,
    description:
      'POS support for sales tickets, items, payments, and operational reporting.',
  },
  {
    slug: 'erply',
    category: 'Point of Sale',
    name: 'Erply',
    status: 'planned',
    docsPath: 'docs/integrations/wave3-partner-surface.md',
    adapterKey: null,
    description:
      'Retail POS and inventory connectivity for sales, products, stock, and accounting handoff.',
  },
  {
    slug: 'marketman',
    category: 'Point of Sale',
    name: 'MarketMan',
    status: 'planned',
    docsPath: 'docs/integrations/wave3-partner-surface.md',
    adapterKey: null,
    description:
      'Restaurant inventory and purchasing connectivity for cost control, stock, and supplier workflows.',
  },
  {
    slug: 'quickbooks-online',
    category: 'Accounting & ERP',
    name: 'QuickBooks Online',
    status: 'planned',
    docsPath: 'docs/integrations/wave3-partner-surface.md',
    adapterKey: null,
    description:
      'Accounting sync for invoices, payments, deposits, customers, taxes, and revenue summaries.',
  },
  {
    slug: 'xero',
    category: 'Accounting & ERP',
    name: 'Xero',
    status: 'planned',
    docsPath: 'docs/integrations/wave3-partner-surface.md',
    adapterKey: null,
    description:
      'Accounting connectivity for contacts, invoices, payments, bank reconciliation, and tax reporting.',
  },
  {
    slug: 'sage-business-cloud',
    category: 'Accounting & ERP',
    name: 'Sage Business Cloud',
    status: 'planned',
    docsPath: 'docs/integrations/wave3-partner-surface.md',
    adapterKey: null,
    description:
      'Accounting integration for customer accounts, invoices, payments, and ledger exports.',
  },
  {
    slug: 'zoho-books',
    category: 'Accounting & ERP',
    name: 'Zoho Books',
    status: 'planned',
    docsPath: 'docs/integrations/wave3-partner-surface.md',
    adapterKey: null,
    description:
      'Accounting sync for contacts, invoices, payments, taxes, and reporting data.',
  },
  {
    slug: 'datev',
    category: 'Accounting & ERP',
    name: 'DATEV',
    status: 'planned',
    docsPath: 'docs/integrations/wave3-partner-surface.md',
    adapterKey: null,
    description:
      'German accounting export support for bookkeeping, tax advisor handoff, and structured ledger data.',
  },
  {
    slug: 'bexio',
    category: 'Accounting & ERP',
    name: 'Bexio',
    status: 'planned',
    docsPath: 'docs/integrations/wave3-partner-surface.md',
    adapterKey: null,
    description:
      'Swiss accounting connectivity for contacts, invoices, payments, and document workflows.',
  },
  {
    slug: 'exact-online',
    category: 'Accounting & ERP',
    name: 'Exact Online',
    status: 'planned',
    docsPath: 'docs/integrations/wave3-partner-surface.md',
    adapterKey: null,
    description:
      'ERP and accounting integration for financial entries, contacts, invoices, and payment records.',
  },
  {
    slug: 'sage-50-csv',
    category: 'Accounting & ERP',
    name: 'Sage 50 CSV',
    status: 'recipe',
    docsPath: 'docs/integrations/accounting-csv.md',
    adapterKey: null,
    description:
      'CSV export path for Sage 50 import workflows covering invoices, payments, and account mappings.',
  },
  {
    slug: 'salto-ks',
    category: 'Door Locks & Access',
    name: 'Salto KS',
    status: 'shipped',
    docsPath: 'docs/integrations/door-locks-nuki-ttlock-salto.md',
    adapterKey: 'salto_ks',
    description:
      'Cloud access control support for issuing, updating, and revoking guest and staff access.',
  },
  {
    slug: 'nuki',
    category: 'Door Locks & Access',
    name: 'Nuki',
    status: 'shipped',
    docsPath: 'docs/integrations/door-locks-nuki-ttlock-salto.md',
    adapterKey: 'nuki',
    description:
      'Smart lock support for access grants, time windows, revocation, and operational status.',
  },
  {
    slug: 'ttlock',
    category: 'Door Locks & Access',
    name: 'TTLock',
    status: 'shipped',
    docsPath: 'docs/integrations/door-locks-nuki-ttlock-salto.md',
    adapterKey: 'ttlock',
    description:
      'Smart lock API support for PINs, eKeys, access windows, and lock status workflows.',
  },
  {
    slug: 'veriff',
    category: 'ID Verification & Online Check-in',
    name: 'Veriff',
    status: 'planned',
    docsPath: 'docs/integrations/wave3-partner-surface.md',
    adapterKey: null,
    description:
      'Identity verification support for document review, biometric checks, and verification decisions.',
  },
  {
    slug: 'civitfun',
    category: 'ID Verification & Online Check-in',
    name: 'Civitfun',
    status: 'planned',
    docsPath: 'docs/integrations/wave3-partner-surface.md',
    adapterKey: null,
    description:
      'Online check-in platform connectivity for guest data, upsells, payments, and digital arrival flows.',
  },
  {
    slug: 'straiv',
    category: 'ID Verification & Online Check-in',
    name: 'Straiv',
    status: 'planned',
    docsPath: 'docs/integrations/wave3-partner-surface.md',
    adapterKey: null,
    description:
      'Online check-in support for guest forms, arrival data, identity capture, and guest messaging.',
  },
  {
    slug: 'adriascan',
    category: 'ID Verification & Online Check-in',
    name: 'AdriaScan',
    status: 'planned',
    docsPath: 'docs/integrations/wave3-partner-surface.md',
    adapterKey: null,
    description:
      'Document scanning support for passport, ID, and guest registration data capture.',
  },
  {
    slug: 'samsotech-vicas',
    category: 'ID Verification & Online Check-in',
    name: 'Samsotech VICAS',
    status: 'planned',
    docsPath: 'docs/integrations/wave3-partner-surface.md',
    adapterKey: null,
    description:
      'Identity scanning and guest registration support for document capture and compliance workflows.',
  },
  {
    slug: 'stripe-identity',
    category: 'ID Verification & Online Check-in',
    name: 'Stripe Identity',
    status: 'planned',
    docsPath: 'docs/integrations/wave3-partner-surface.md',
    adapterKey: null,
    description:
      'Identity verification support for document checks, selfie checks, and hosted verification sessions.',
  },
  {
    slug: 'croatia-evisitor',
    category: 'ID Verification & Online Check-in',
    name: 'Croatia eVisitor',
    status: 'adapter',
    docsPath: 'docs/integrations/wave3-fiscal-guest-reg.md',
    adapterKey: 'croatia_evisitor',
    description:
      'Guest registration pathway for Croatian tourist registration requirements.',
  },
  {
    slug: 'italy-alloggiati-web',
    category: 'ID Verification & Online Check-in',
    name: 'Italy Alloggiati Web',
    status: 'adapter',
    docsPath: 'docs/integrations/wave3-fiscal-guest-reg.md',
    adapterKey: 'italy_alloggiati',
    description:
      'Guest registration pathway for Italian police accommodation reporting requirements.',
  },
  {
    slug: 'serbia-eturista',
    category: 'ID Verification & Online Check-in',
    name: 'Serbia eTurista',
    status: 'shipped',
    docsPath: 'docs/integrations/serbia-fiscal.md',
    adapterKey: 'serbia_eturista',
    description:
      'Guest registration pathway for Serbian accommodation reporting requirements.',
  },
  {
    slug: 'pricelabs',
    category: 'Revenue Management & Pricing',
    name: 'PriceLabs',
    status: 'planned',
    docsPath: 'docs/integrations/wave3-partner-surface.md',
    adapterKey: null,
    description:
      'Dynamic pricing connectivity for short-term rental and hotel rates, minimum stays, and restrictions.',
  },
  {
    slug: 'beyond-pricing',
    category: 'Revenue Management & Pricing',
    name: 'Beyond Pricing',
    status: 'planned',
    docsPath: 'docs/integrations/wave3-partner-surface.md',
    adapterKey: null,
    description:
      'Dynamic pricing support for vacation rental and lodging rates, demand signals, and rate pushes.',
  },
  {
    slug: 'roompricegenie',
    category: 'Revenue Management & Pricing',
    name: 'RoomPriceGenie',
    status: 'planned',
    docsPath: 'docs/integrations/wave3-partner-surface.md',
    adapterKey: null,
    description:
      'Revenue management connectivity for recommended rates, pricing rules, and rate updates.',
  },
  {
    slug: 'duetto',
    category: 'Revenue Management & Pricing',
    name: 'Duetto',
    status: 'planned',
    docsPath: 'docs/integrations/wave3-partner-surface.md',
    adapterKey: null,
    description:
      'Revenue strategy system connectivity for pricing recommendations, restrictions, and performance data.',
  },
  {
    slug: 'ideas',
    category: 'Revenue Management & Pricing',
    name: 'IDeaS',
    status: 'planned',
    docsPath: 'docs/integrations/wave3-partner-surface.md',
    adapterKey: null,
    description:
      'Revenue management integration path for forecasts, pricing recommendations, and inventory controls.',
  },
  {
    slug: 'beonx',
    category: 'Revenue Management & Pricing',
    name: 'BEONX',
    status: 'planned',
    docsPath: 'docs/integrations/wave3-partner-surface.md',
    adapterKey: null,
    description:
      'Revenue management support for demand intelligence, rate recommendations, and pricing workflows.',
  },
  {
    slug: 'diamo',
    category: 'Revenue Management & Pricing',
    name: 'DIAMO',
    status: 'planned',
    docsPath: 'docs/integrations/wave3-partner-surface.md',
    adapterKey: null,
    description:
      'Revenue management connectivity for pricing recommendations and performance monitoring.',
  },
  {
    slug: 'lighthouse-market-data',
    category: 'Revenue Management & Pricing',
    name: 'Lighthouse Market Data',
    status: 'planned',
    docsPath: 'docs/integrations/wave3-partner-surface.md',
    adapterKey: null,
    description:
      'Market intelligence support for rate shopping, demand data, and pricing context.',
  },
  {
    slug: 'wheelhouse',
    category: 'Revenue Management & Pricing',
    name: 'Wheelhouse',
    status: 'planned',
    docsPath: 'docs/integrations/wave3-partner-surface.md',
    adapterKey: null,
    description:
      'Dynamic pricing support for rental rates, demand insights, and calendar-based rate updates.',
  },
  {
    slug: 'flexkeeping',
    category: 'Housekeeping & Operations',
    name: 'Flexkeeping',
    status: 'planned',
    docsPath: 'docs/integrations/wave3-partner-surface.md',
    adapterKey: null,
    description:
      'Housekeeping and staff operations connectivity for tasks, room status, maintenance, and team communication.',
  },
  {
    slug: 'quore',
    category: 'Housekeeping & Operations',
    name: 'Quore',
    status: 'planned',
    docsPath: 'docs/integrations/wave3-partner-surface.md',
    adapterKey: null,
    description:
      'Hotel operations integration for housekeeping, maintenance, requests, and property team workflows.',
  },
  {
    slug: 'duve-housekeeping-task-sync',
    category: 'Housekeeping & Operations',
    name: 'Duve Housekeeping Task Sync',
    status: 'planned',
    docsPath: 'docs/integrations/wave3-partner-surface.md',
    adapterKey: null,
    description:
      'Housekeeping task synchronization for guest requests, room readiness, and service follow-up.',
  },
  {
    slug: 'zapier',
    category: 'Automation Platforms',
    name: 'Zapier',
    status: 'recipe',
    docsPath: 'docs/integrations/webhooks-zapier.md',
    adapterKey: null,
    description:
      'No-code automation support through webhooks and API actions for guest, reservation, and operational workflows.',
  },
  {
    slug: 'make-com',
    category: 'Automation Platforms',
    name: 'Make.com',
    status: 'recipe',
    docsPath: 'docs/integrations/webhooks-make.md',
    adapterKey: null,
    description:
      'Scenario automation support through webhooks, HTTP modules, and connected app workflows.',
  },
  {
    slug: 'n8n',
    category: 'Automation Platforms',
    name: 'n8n',
    status: 'recipe',
    docsPath: 'docs/integrations/webhooks-n8n.md',
    adapterKey: null,
    description:
      'Open workflow automation support through webhooks, HTTP nodes, and API-key authenticated calls.',
  },
  {
    slug: 'slack-incoming-webhooks',
    category: 'Automation Platforms',
    name: 'Slack Incoming Webhooks',
    status: 'recipe',
    docsPath: 'docs/integrations/slack-teams-discord.md',
    adapterKey: null,
    description:
      'Slack notification support for reservation events, operational alerts, and team updates.',
  },
  {
    slug: 'discord-webhooks',
    category: 'Automation Platforms',
    name: 'Discord Webhooks',
    status: 'recipe',
    docsPath: 'docs/integrations/slack-teams-discord.md',
    adapterKey: null,
    description:
      'Discord notification support for operational channels, alerts, and team-visible event streams.',
  },
  {
    slug: 'zapier-partner-app',
    category: 'Automation Platforms',
    name: 'Zapier Partner App listing',
    status: 'planned',
    docsPath: 'docs/integrations/wave3-partner-surface.md',
    adapterKey: null,
    description:
      'Official Zapier partner app listing and certified triggers/actions beyond generic webhook catch.',
  },
  {
    slug: 'make-partner-app',
    category: 'Automation Platforms',
    name: 'Make Partner App listing',
    status: 'planned',
    docsPath: 'docs/integrations/wave3-partner-surface.md',
    adapterKey: null,
    description:
      'Official Make.com partner app listing and certified modules beyond generic HTTP webhooks.',
  },
  {
    slug: 'ifttt-partner-app',
    category: 'Automation Platforms',
    name: 'IFTTT Partner App listing',
    status: 'planned',
    docsPath: 'docs/integrations/wave3-partner-surface.md',
    adapterKey: null,
    description:
      'IFTTT partner applet/service listing for trigger-action workflows connected to HAIP events.',
  },
  {
    slug: 'metabase',
    category: 'BI & Analytics',
    name: 'Metabase',
    status: 'recipe',
    docsPath: 'docs/integrations/bi-postgres.md',
    adapterKey: null,
    description:
      'Open-source BI support for PostgreSQL reporting, dashboards, and scheduled analytics.',
  },
  {
    slug: 'apache-superset',
    category: 'BI & Analytics',
    name: 'Apache Superset',
    status: 'planned',
    docsPath: 'docs/integrations/wave3-partner-surface.md',
    adapterKey: null,
    description:
      'Open-source analytics support for charts, dashboards, and governed SQL datasets.',
  },
  {
    slug: 'looker-studio',
    category: 'BI & Analytics',
    name: 'Looker Studio',
    status: 'planned',
    docsPath: 'docs/integrations/wave3-partner-surface.md',
    adapterKey: null,
    description:
      'Reporting support through structured exports, database connections, and dashboard-ready datasets.',
  },
  {
    slug: 'amadeus-demand360',
    category: 'BI & Analytics',
    name: 'Amadeus Demand360',
    status: 'planned',
    docsPath: 'docs/integrations/wave3-partner-surface.md',
    adapterKey: null,
    description:
      'Market demand intelligence connectivity for forward-looking demand context and performance analysis.',
  },
  {
    slug: 'top-report',
    category: 'BI & Analytics',
    name: 'Top-Report',
    status: 'planned',
    docsPath: 'docs/integrations/wave3-partner-surface.md',
    adapterKey: null,
    description:
      'Hotel reporting connectivity for performance dashboards, exports, and management analytics.',
  },
  {
    slug: 'grafana',
    category: 'BI & Analytics',
    name: 'Grafana',
    status: 'planned',
    docsPath: 'docs/integrations/bi-postgres.md',
    adapterKey: null,
    description:
      'Metrics and dashboard support for operations, system health, and business observability.',
  },
  {
    slug: 'documenso',
    category: 'Open Standards & Infrastructure',
    name: 'Documenso',
    status: 'planned',
    docsPath: 'docs/integrations/wave3-partner-surface.md',
    adapterKey: null,
    description:
      'Open-source e-signature support for contracts, forms, and guest documents.',
  },
  {
    slug: 'dropbox-sign',
    category: 'Open Standards & Infrastructure',
    name: 'Dropbox Sign',
    status: 'planned',
    docsPath: 'docs/integrations/wave3-partner-surface.md',
    adapterKey: null,
    description:
      'E-signature workflow support for agreements, authorizations, and operational documents.',
  },
  {
    slug: 'outlook-graph-calendar',
    category: 'Open Standards & Infrastructure',
    name: 'Outlook/Graph Calendar',
    status: 'planned',
    docsPath: 'docs/integrations/wave3-partner-surface.md',
    adapterKey: null,
    description:
      'Calendar sync support for Outlook and Microsoft Graph availability, events, and operational schedules.',
  },
  {
    slug: 'opentravel-htng-xml',
    category: 'Open Standards & Infrastructure',
    name: 'OpenTravel/HTNG XML',
    status: 'planned',
    docsPath: 'docs/integrations/wave3-partner-surface.md',
    adapterKey: null,
    description:
      'Hospitality XML standard support for distribution, reservations, profiles, and operational interoperability.',
  },
  {
    slug: 'ical-import-export',
    category: 'Open Standards & Infrastructure',
    name: 'iCal Import/Export',
    status: 'recipe',
    docsPath: 'docs/integrations/ical-calendar-bridge.md',
    adapterKey: null,
    description:
      'Calendar standard support for availability import, availability export, and channel calendar bridging.',
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
    slug: 'serbia-suf-esir',
    category: 'Fiscalization & Tax Compliance (worldwide)',
    name: 'Serbia SUF/ESIR',
    status: 'shipped',
    docsPath: 'docs/integrations/serbia-fiscal.md',
    adapterKey: 'serbia_suf_esir',
    description:
      'Fiscal device and receipt workflow support for Serbian fiscalization requirements.',
  },
  {
    slug: 'fiskaly-sign-at',
    category: 'Fiscalization & Tax Compliance (worldwide)',
    name: 'fiskaly SIGN AT',
    status: 'adapter',
    docsPath: 'docs/integrations/fiskaly-sign-at.md',
    adapterKey: 'fiskaly_sign_at',
    description:
      'Austrian RKSV signing support for compliant receipt signing and fiscal records.',
  },
  {
    slug: 'fiskaly-sign-de',
    category: 'Fiscalization & Tax Compliance (worldwide)',
    name: 'fiskaly SIGN DE',
    status: 'adapter',
    docsPath: 'docs/integrations/wave3-fiscal-guest-reg.md',
    adapterKey: 'fiskaly_sign_de',
    description:
      'German TSE signing support for compliant receipt signing and audit data workflows.',
  },
  {
    slug: 'croatia-fiskalizacija-2',
    category: 'Fiscalization & Tax Compliance (worldwide)',
    name: 'Croatia Fiskalizacija 2.0',
    status: 'adapter',
    docsPath: 'docs/integrations/wave3-fiscal-guest-reg.md',
    adapterKey: 'croatia_fiskalizacija_2',
    description:
      'Fiscal receipt and e-invoicing workflow support for Croatian fiscalization requirements.',
  },
  {
    slug: 'slovenia-furs',
    category: 'Fiscalization & Tax Compliance (worldwide)',
    name: 'Slovenia FURS',
    status: 'adapter',
    docsPath: 'docs/integrations/wave3-fiscal-guest-reg.md',
    adapterKey: 'slovenia_furs',
    description:
      'Fiscal receipt reporting support for Slovenian tax authority requirements.',
  },
  {
    slug: 'vies',
    category: 'Fiscalization & Tax Compliance (worldwide)',
    name: 'VIES',
    status: 'adapter',
    docsPath: 'docs/integrations/wave3-fiscal-guest-reg.md',
    adapterKey: 'vies',
    description:
      'EU VAT number validation support for business guest and invoicing workflows.',
  },
  {
    slug: 'nbs-exchange-rates',
    category: 'Fiscalization & Tax Compliance (worldwide)',
    name: 'NBS exchange rates',
    status: 'adapter',
    docsPath: 'docs/integrations/wave3-fiscal-guest-reg.md',
    adapterKey: 'nbs_exchange_rates',
    description:
      'Serbian central bank exchange rate support for currency conversion and reporting.',
  },
  {
    slug: 'north-macedonia-efaktura',
    category: 'Fiscalization & Tax Compliance (worldwide)',
    name: 'North Macedonia e-Faktura',
    status: 'adapter',
    docsPath: 'docs/integrations/wave3-fiscal-guest-reg.md',
    adapterKey: 'north_macedonia_efaktura',
    description:
      'E-invoicing workflow support for North Macedonian fiscal documentation.',
  },
  {
    slug: 'bih-fiscalization',
    category: 'Fiscalization & Tax Compliance (worldwide)',
    name: 'BiH fiscalization',
    status: 'adapter',
    docsPath: 'docs/integrations/wave3-fiscal-guest-reg.md',
    adapterKey: 'bih_fiscalization',
    description:
      'Fiscal receipt workflow support for Bosnia and Herzegovina fiscalization requirements.',
  },
  {
    slug: 'montenegro-fiskalizacija',
    category: 'Fiscalization & Tax Compliance (worldwide)',
    name: 'Montenegro Fiskalizacija',
    status: 'adapter',
    docsPath: 'docs/integrations/wave3-fiscal-guest-reg.md',
    adapterKey: 'montenegro_fiskalizacija',
    description:
      'Fiscal receipt reporting support for Montenegrin fiscalization requirements.',
  },
  {
    slug: 'belgium-peppol-b2b',
    category: 'Fiscalization & Tax Compliance (worldwide)',
    name: 'Belgium Peppol B2B',
    status: 'adapter',
    docsPath: 'docs/integrations/wave3-fiscal-guest-reg.md',
    adapterKey: 'belgium_peppol_b2b',
    description:
      'Peppol e-invoicing support for Belgian business-to-business invoice exchange.',
  },
  {
    slug: 'luxembourg-peppol',
    category: 'Fiscalization & Tax Compliance (worldwide)',
    name: 'Luxembourg Peppol upcoming',
    status: 'adapter',
    docsPath: 'docs/integrations/wave3-fiscal-guest-reg.md',
    adapterKey: 'luxembourg_peppol',
    description:
      'Peppol e-invoicing pathway for Luxembourg business invoice exchange as mandates evolve.',
  },
  {
    slug: 'ireland-vat-modernisation',
    category: 'Fiscalization & Tax Compliance (worldwide)',
    name: 'Ireland VAT Modernisation',
    status: 'adapter',
    docsPath: 'docs/integrations/wave3-fiscal-guest-reg.md',
    adapterKey: 'ireland_vat_modernisation',
    description:
      'VAT reporting support for Irish digital VAT compliance workflows.',
  },
  {
    slug: 'uk-mtd-vat',
    category: 'Fiscalization & Tax Compliance (worldwide)',
    name: 'UK MTD VAT',
    status: 'adapter',
    docsPath: 'docs/integrations/wave3-fiscal-guest-reg.md',
    adapterKey: 'uk_mtd_vat',
    description:
      'Making Tax Digital VAT support for return preparation and submission workflows.',
  },
  {
    slug: 'swiss-qr-bill',
    category: 'Fiscalization & Tax Compliance (worldwide)',
    name: 'Swiss QR-bill',
    status: 'adapter',
    docsPath: 'docs/integrations/wave3-fiscal-guest-reg.md',
    adapterKey: 'swiss_qr_bill',
    description:
      'QR-bill payment reference support for Swiss invoicing and bank payment workflows.',
  },
  {
    slug: 'italy-sdi',
    category: 'Fiscalization & Tax Compliance (worldwide)',
    name: 'Italy SDI',
    status: 'adapter',
    docsPath: 'docs/integrations/wave3-fiscal-guest-reg.md',
    adapterKey: 'italy_sdi',
    description:
      'E-invoicing support for Italian Sistema di Interscambio invoice exchange.',
  },
  {
    slug: 'spain-verifactu',
    category: 'Fiscalization & Tax Compliance (worldwide)',
    name: 'Spain VeriFactu',
    status: 'adapter',
    docsPath: 'docs/integrations/wave3-fiscal-guest-reg.md',
    adapterKey: 'spain_verifactu',
    description:
      'Verifiable invoice record support for Spanish anti-fraud invoicing requirements.',
  },
  {
    slug: 'ticketbai',
    category: 'Fiscalization & Tax Compliance (worldwide)',
    name: 'TicketBAI',
    status: 'adapter',
    docsPath: 'docs/integrations/wave3-fiscal-guest-reg.md',
    adapterKey: 'spain_ticketbai',
    description:
      'Basque Country invoice reporting support for TicketBAI fiscal requirements.',
  },
  {
    slug: 'sii',
    category: 'Fiscalization & Tax Compliance (worldwide)',
    name: 'SII',
    status: 'adapter',
    docsPath: 'docs/integrations/wave3-fiscal-guest-reg.md',
    adapterKey: 'spain_sii',
    description:
      'Spanish Immediate Supply of Information VAT reporting workflow support.',
  },
  {
    slug: 'greece-mydata',
    category: 'Fiscalization & Tax Compliance (worldwide)',
    name: 'Greece myDATA',
    status: 'adapter',
    docsPath: 'docs/integrations/wave3-fiscal-guest-reg.md',
    adapterKey: 'greece_mydata',
    description:
      'E-books and invoice classification workflow support for Greek AADE myDATA requirements.',
  },
  {
    slug: 'estonia-e-invoicing',
    category: 'Fiscalization & Tax Compliance (worldwide)',
    name: 'Estonia e-invoicing',
    status: 'adapter',
    docsPath: 'docs/integrations/wave3-fiscal-guest-reg.md',
    adapterKey: 'estonia_einvoicing',
    description:
      'Structured e-invoicing support for Estonian public and business invoice exchange.',
  },
  {
    slug: 'latvia-vid',
    category: 'Fiscalization & Tax Compliance (worldwide)',
    name: 'Latvia VID',
    status: 'adapter',
    docsPath: 'docs/integrations/wave3-fiscal-guest-reg.md',
    adapterKey: 'latvia_vid',
    description:
      'Tax authority reporting pathway for Latvian fiscal and invoice workflows.',
  },
  {
    slug: 'poland-ksef',
    category: 'Fiscalization & Tax Compliance (worldwide)',
    name: 'Poland KSeF',
    status: 'adapter',
    docsPath: 'docs/integrations/wave3-fiscal-guest-reg.md',
    adapterKey: 'poland_ksef',
    description:
      'National e-invoicing support for Polish structured invoice exchange.',
  },
  {
    slug: 'hungary-nav-3',
    category: 'Fiscalization & Tax Compliance (worldwide)',
    name: 'Hungary NAV 3.0',
    status: 'adapter',
    docsPath: 'docs/integrations/wave3-fiscal-guest-reg.md',
    adapterKey: 'hungary_nav_3',
    description:
      'Real-time invoice data reporting support for Hungarian NAV requirements.',
  },
  {
    slug: 'hungary-ntak',
    category: 'Fiscalization & Tax Compliance (worldwide)',
    name: 'Hungary NTAK',
    status: 'adapter',
    docsPath: 'docs/integrations/wave3-fiscal-guest-reg.md',
    adapterKey: 'hungary_ntak',
    description:
      'Accommodation data reporting pathway for Hungarian tourism reporting requirements.',
  },
  {
    slug: 'romania-ro-efactura',
    category: 'Fiscalization & Tax Compliance (worldwide)',
    name: 'Romania RO e-Factura',
    status: 'adapter',
    docsPath: 'docs/integrations/wave3-fiscal-guest-reg.md',
    adapterKey: 'romania_ro_efactura',
    description:
      'E-invoicing support for Romanian RO e-Factura invoice exchange.',
  },
  {
    slug: 'mexico-cfdi',
    category: 'Fiscalization & Tax Compliance (worldwide)',
    name: 'Mexico CFDI',
    status: 'adapter',
    docsPath: 'docs/integrations/wave3-fiscal-guest-reg.md',
    adapterKey: 'mexico_cfdi',
    description:
      'Electronic invoice workflow support for Mexican CFDI fiscal documents.',
  },
  {
    slug: 'el-salvador-dte',
    category: 'Fiscalization & Tax Compliance (worldwide)',
    name: 'El Salvador DTE',
    status: 'adapter',
    docsPath: 'docs/integrations/wave3-fiscal-guest-reg.md',
    adapterKey: 'el_salvador_dte',
    description:
      'Electronic tax document workflow support for Salvadoran DTE requirements.',
  },
  {
    slug: 'colombia-dian',
    category: 'Fiscalization & Tax Compliance (worldwide)',
    name: 'Colombia DIAN',
    status: 'adapter',
    docsPath: 'docs/integrations/wave3-fiscal-guest-reg.md',
    adapterKey: 'colombia_dian',
    description:
      'Electronic invoicing support for Colombian DIAN fiscal document requirements.',
  },
  {
    slug: 'ecuador-sri',
    category: 'Fiscalization & Tax Compliance (worldwide)',
    name: 'Ecuador SRI',
    status: 'adapter',
    docsPath: 'docs/integrations/wave3-fiscal-guest-reg.md',
    adapterKey: 'ecuador_sri',
    description:
      'Electronic receipt and invoice workflow support for Ecuadorian SRI requirements.',
  },
  {
    slug: 'luxembourg-fiches',
    category: 'Government Guest Registration (worldwide)',
    name: 'Luxembourg fiches d\'hébergement',
    status: 'adapter',
    docsPath: 'docs/integrations/wave3-fiscal-guest-reg.md',
    adapterKey: 'luxembourg_fiches',
    description:
      'Guest registration pathway for Luxembourg accommodation record requirements.',
  },
  {
    slug: 'portugal-siba',
    category: 'Government Guest Registration (worldwide)',
    name: 'Portugal SIBA',
    status: 'adapter',
    docsPath: 'docs/integrations/wave3-fiscal-guest-reg.md',
    adapterKey: 'portugal_siba',
    description:
      'Guest accommodation reporting pathway for Portuguese border and immigration requirements.',
  },
  {
    slug: 'andorra-roat',
    category: 'Government Guest Registration (worldwide)',
    name: 'Andorra ROAT',
    status: 'adapter',
    docsPath: 'docs/integrations/wave3-fiscal-guest-reg.md',
    adapterKey: 'andorra_roat',
    description:
      'Accommodation registration pathway for Andorran tourism and lodging reporting requirements.',
  },
  {
    slug: 'czechia-ubyport',
    category: 'Government Guest Registration (worldwide)',
    name: 'Czechia Ubyport',
    status: 'adapter',
    docsPath: 'docs/integrations/wave3-fiscal-guest-reg.md',
    adapterKey: 'czechia_ubyport',
    description:
      'Guest reporting pathway for Czech foreign police accommodation registration requirements.',
  },
  {
    slug: 'finland-matkustajailmoitus',
    category: 'Government Guest Registration (worldwide)',
    name: 'Finland Matkustajailmoitus',
    status: 'adapter',
    docsPath: 'docs/integrations/wave3-fiscal-guest-reg.md',
    adapterKey: 'finland_matkustajailmoitus',
    description:
      'Traveller notification workflow support for Finnish accommodation registration requirements.',
  },
  {
    slug: 'uruguay-rihp',
    category: 'Government Guest Registration (worldwide)',
    name: 'Uruguay RIHP',
    status: 'adapter',
    docsPath: 'docs/integrations/wave3-fiscal-guest-reg.md',
    adapterKey: 'uruguay_rihp',
    description:
      'Guest and lodging registration pathway for Uruguayan hospitality reporting requirements.',
  },
  {
    slug: 'france-nf525-factur-x',
    category: 'Compliance Market Entry (paid/gated)',
    name: 'France NF525 + Factur-X/PDP',
    status: 'planned',
    docsPath: 'docs/integrations/compliance-market-entry.md',
    adapterKey: null,
    description:
      'Paid cert / hardware path — schedule by market entry; not a free API connector.',
  },
  {
    slug: 'belgium-gks-fdm',
    category: 'Compliance Market Entry (paid/gated)',
    name: 'Belgium GKS/FDM',
    status: 'planned',
    docsPath: 'docs/integrations/compliance-market-entry.md',
    adapterKey: null,
    description:
      'Paid fiscal device path — schedule by market entry; not a free API connector.',
  },
  {
    slug: 'italy-rt-corrispettivi',
    category: 'Compliance Market Entry (paid/gated)',
    name: 'Italy RT corrispettivi',
    status: 'planned',
    docsPath: 'docs/integrations/compliance-market-entry.md',
    adapterKey: null,
    description:
      'Registratore Telematico hardware path — schedule by market entry.',
  },
  {
    slug: 'portugal-at-saft',
    category: 'Compliance Market Entry (paid/gated)',
    name: 'Portugal AT + SAF-T',
    status: 'planned',
    docsPath: 'docs/integrations/compliance-market-entry.md',
    adapterKey: null,
    description:
      'Authority + SAF-T reporting — paid/gated market-entry pack.',
  },
  {
    slug: 'sweden-control-unit',
    category: 'Compliance Market Entry (paid/gated)',
    name: 'Sweden control unit',
    status: 'planned',
    docsPath: 'docs/integrations/compliance-market-entry.md',
    adapterKey: null,
    description:
      'Control unit requirement — paid/gated market-entry pack.',
  },
  {
    slug: 'poland-kasa-fiskalna',
    category: 'Compliance Market Entry (paid/gated)',
    name: 'Poland kasa fiskalna',
    status: 'planned',
    docsPath: 'docs/integrations/compliance-market-entry.md',
    adapterKey: null,
    description:
      'Fiscal cash register path — paid/gated market-entry pack.',
  },
  {
    slug: 'slovakia-efaktura-2027',
    category: 'Compliance Market Entry (paid/gated)',
    name: 'Slovakia eFaktúra 2027',
    status: 'planned',
    docsPath: 'docs/integrations/compliance-market-entry.md',
    adapterKey: null,
    description:
      'Upcoming mandate — schedule by market entry; not claimed free.',
  },
  {
    slug: 'romania-amef',
    category: 'Compliance Market Entry (paid/gated)',
    name: 'Romania AMEF',
    status: 'planned',
    docsPath: 'docs/integrations/compliance-market-entry.md',
    adapterKey: null,
    description:
      'Fiscal device path — paid/gated market-entry pack.',
  },
  {
    slug: 'bulgaria-supto',
    category: 'Compliance Market Entry (paid/gated)',
    name: 'Bulgaria SUPTO',
    status: 'planned',
    docsPath: 'docs/integrations/compliance-market-entry.md',
    adapterKey: null,
    description:
      'Fiscal device path — paid/gated market-entry pack.',
  },
  {
    slug: 'austria-feratel-meldewesen',
    category: 'Compliance Market Entry (paid/gated)',
    name: 'Austria feratel Meldewesen',
    status: 'planned',
    docsPath: 'docs/integrations/compliance-market-entry.md',
    adapterKey: null,
    description:
      'Tyrol/Burgenland tourism reporting — paid/gated market-entry pack.',
  },
  {
    slug: 'germany-meldeschein',
    category: 'Compliance Market Entry (paid/gated)',
    name: 'Germany Meldeschein',
    status: 'planned',
    docsPath: 'docs/integrations/compliance-market-entry.md',
    adapterKey: null,
    description:
      'Feature-only guest form generate/retain; no authority API — not claimed free automated filing.',
  },
  {
    slug: 'austria-gaesteverzeichnis',
    category: 'Compliance Market Entry (paid/gated)',
    name: 'Austria Gästeverzeichnis',
    status: 'planned',
    docsPath: 'docs/integrations/compliance-market-entry.md',
    adapterKey: null,
    description:
      'Feature-only guest directory generate/retain; no authority API.',
  },
  {
    slug: 'netherlands-nachtregister',
    category: 'Compliance Market Entry (paid/gated)',
    name: 'Netherlands nachtregister',
    status: 'planned',
    docsPath: 'docs/integrations/compliance-market-entry.md',
    adapterKey: null,
    description:
      'Feature-only night register generate/retain; no authority API.',
  },
  {
    slug: 'belgium-traveler-register',
    category: 'Compliance Market Entry (paid/gated)',
    name: 'Belgium traveler register',
    status: 'planned',
    docsPath: 'docs/integrations/compliance-market-entry.md',
    adapterKey: null,
    description:
      'Feature-only traveler register generate/retain; no authority API.',
  },
  {
    slug: 'liechtenstein-guest-register',
    category: 'Compliance Market Entry (paid/gated)',
    name: 'Liechtenstein guest register',
    status: 'planned',
    docsPath: 'docs/integrations/compliance-market-entry.md',
    adapterKey: null,
    description:
      'Feature-only local register generate/retain; no authority API.',
  },
  {
    slug: 'france-fiche-de-police',
    category: 'Compliance Market Entry (paid/gated)',
    name: 'France fiche de police',
    status: 'planned',
    docsPath: 'docs/integrations/compliance-market-entry.md',
    adapterKey: null,
    description:
      'Feature-only police fiche generate/retain; no authority API.',
  },
  {
    slug: 'uk-hotel-records',
    category: 'Compliance Market Entry (paid/gated)',
    name: 'UK Hotel Records',
    status: 'planned',
    docsPath: 'docs/integrations/compliance-market-entry.md',
    adapterKey: null,
    description:
      'Feature-only guest records retention workflow; no authority API.',
  },
  {
    slug: 'greece-guest-book',
    category: 'Compliance Market Entry (paid/gated)',
    name: 'Greece Βιβλίο Πελατών',
    status: 'planned',
    docsPath: 'docs/integrations/compliance-market-entry.md',
    adapterKey: null,
    description:
      'Feature-only guest book generate/retain; no authority API.',
  },
  {
    slug: 'malta-guest-register',
    category: 'Compliance Market Entry (paid/gated)',
    name: 'Malta guest register',
    status: 'planned',
    docsPath: 'docs/integrations/compliance-market-entry.md',
    adapterKey: null,
    description:
      'Feature-only guest register generate/retain; no authority API.',
  },
  {
    slug: 'san-marino-tourist-tax',
    category: 'Compliance Market Entry (paid/gated)',
    name: 'San Marino tourist tax remittance',
    status: 'planned',
    docsPath: 'docs/integrations/compliance-market-entry.md',
    adapterKey: null,
    description:
      'Feature-only tax remittance workflow; no free automated filing claim.',
  },
  {
    slug: 'ecuador-siete-establishment',
    category: 'Compliance Market Entry (paid/gated)',
    name: 'Ecuador SIETE establishment-only',
    status: 'planned',
    docsPath: 'docs/integrations/compliance-market-entry.md',
    adapterKey: null,
    description:
      'Establishment reporting feature pack — schedule by market entry.',
  },
  {
    slug: 'ses-hospedajes',
    category: 'Compliance Market Entry (paid/gated)',
    name: 'SES.Hospedajes',
    status: 'planned',
    docsPath: 'docs/integrations/compliance-market-entry.md',
    adapterKey: null,
    description:
      'Spanish guest and lodging registration reporting pathway — market-entry gated compliance pack.',
  },
];
