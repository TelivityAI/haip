# Planned integrations backlog (collaborator build plan)

**Audience:** engineers helping ship the remaining catalog rows.
**Source of truth:** `packages/database/src/schema/integration-registry-seed.ts` (`status: planned`).
**Counts (verify on `main` before claiming):** regenerate with the script note below — do not hand-edit totals blindly.

This file lists **86** planned integrations that are **not** yet `shipped` / `adapter` / `recipe`.
Usable rows already on `main` are documented in [wave3-partner-surface.md](../integrations/wave3-partner-surface.md) and [`integrations/demos/`](../../integrations/demos/).

---

## Grounding rules (non-negotiable)

1. **Do not invent vendor or government API contracts.** If partner docs / KB are missing, STOP and ask.
2. Every property-scoped table/query filters `propertyId` (HAIP multi-tenancy).
3. Status honesty: `shipped` only for real HTTP-capable paths; `adapter` for console handoffs; `recipe` for docs on existing REST/webhooks/CSV/SQL; leave `planned` until one of those is true.
4. Every promoted row needs: registry flip (`status` / `adapterKey` / `docsPath`) + `integrations/demos/<slug>/` (`demo.sh` + `GO_LIVE.md` + README) + manifest entry.
5. One PR per coherent slice (category or small cluster). Cut branches from current `main` with **only that slice’s commits** (repo branch freeze on `main` only — force-push on `cursor/*` is OK).
6. Compliance-22 packs: follow [compliance-market-entry.md](../integrations/compliance-market-entry.md) — never claim free automated authority filing.

---

## Suggested build order

| Wave | Category | Count | Why this order |
|------|----------|------:|----------------|
| P1 | Guest Messaging | 8 | Reuse `notifications` / messaging provider interfaces |
| P2 | Open Standards & Infrastructure | 4 | Prefer recipe or thin adapter on existing Connect/webhooks/calendar surfaces |
| P3 | ID Verification & Online Check-in | 6 | Likely new module + provider interface |
| P4 | Upsells & Ancillaries | 12 | Partner APIs |
| P5 | Housekeeping & Operations | 3 | Partner task-sync |
| P6 | Channel Managers | 2 | Meta/process rows — certification queue & mapping studio |
| P7 | OTA Direct Connectivity | 5 | Partner/cert |
| P8 | Metasearch & Direct Booking | 10 | Partner feeds + deep-link recipes |
| P9 | Revenue Management & Pricing | 9 | Partner RMS |
| P10 | BI & Analytics | 2 | Partner BI — Demand360/Top-Report |
| P11 | Automation Platforms | 3 | Partner **app listing** (Zapier/Make/IFTTT). Webhook recipes already exist — do  |
| P12 | Compliance Market Entry (paid/gated) | 22 | See compliance-market-entry.md — paid/gated or feature-only registers |

Adjust order if a commercial partner unlocks credentials earlier.

---

## Done when (per slug)

- [ ] Works without inventing vendor keys (console / recipe / mock OK)
- [ ] `./integrations/demos/run.sh <slug>` succeeds against local stack
- [ ] `GO_LIVE.md` lists live env / partner steps
- [ ] Registry seed `status` (+ `adapterKey` when applicable) matches reality
- [ ] Public docs under `docs/integrations/` updated; link from [integrations README](../integrations/README.md)

---

## Full inventory (planned)

### Guest Messaging (8)

**Approach:** Reuse `notifications` / messaging provider interfaces; prefer console adapter until vendor keys; do not invent WhatsApp/RCS contracts.

| Slug | Name | Notes |
|------|------|-------|
| `chatwoot` | Chatwoot | Open-source inbox integration for guest messaging, team assignment, and conversation history. |
| `google-rcs` | Google RCS | Rich messaging support for branded guest notifications and interactive service messages. |
| `hijiffy` | HiJiffy | Guest communication adapter for hotel chat, automation, and messaging workflows. |
| `instagram-messaging` | Instagram Messaging | Instagram direct message support for guest inquiries and service conversations. |
| `line-messaging` | LINE | LINE messaging support for guest communication in markets where LINE is a primary channel. |
| `sinch-conversation` | Sinch Conversation | Conversation API support for SMS, WhatsApp, RCS, and other messaging channels. |
| `twilio-conversations-whatsapp` | Twilio Conversations/WhatsApp | Omnichannel conversation support for SMS, WhatsApp, and agent-assisted guest messaging. |
| `viber-business` | Viber Business | Viber business messaging support for guest notifications, service messages, and operational communication. |

### Open Standards & Infrastructure (4)

**Approach:** Prefer recipe or thin adapter on existing Connect/webhooks/calendar surfaces; Documenso/Dropbox Sign need e-sign module decision — STOP if KB silent.

| Slug | Name | Notes |
|------|------|-------|
| `documenso` | Documenso | Open-source e-signature support for contracts, forms, and guest documents. |
| `dropbox-sign` | Dropbox Sign | E-signature workflow support for agreements, authorizations, and operational documents. |
| `opentravel-htng-xml` | OpenTravel/HTNG XML | Hospitality XML standard support for distribution, reservations, profiles, and operational interoperability. |
| `outlook-graph-calendar` | Outlook/Graph Calendar | Calendar sync support for Outlook and Microsoft Graph availability, events, and operational schedules. |

### ID Verification & Online Check-in (6)

**Approach:** Likely new module + provider interface; partner sandbox first; do not invent ID-vendor APIs.

| Slug | Name | Notes |
|------|------|-------|
| `adriascan` | AdriaScan | Document scanning support for passport, ID, and guest registration data capture. |
| `civitfun` | Civitfun | Online check-in platform connectivity for guest data, upsells, payments, and digital arrival flows. |
| `samsotech-vicas` | Samsotech VICAS | Identity scanning and guest registration support for document capture and compliance workflows. |
| `straiv` | Straiv | Online check-in support for guest forms, arrival data, identity capture, and guest messaging. |
| `stripe-identity` | Stripe Identity | Identity verification support for document checks, selfie checks, and hosted verification sessions. |
| `veriff` | Veriff | Identity verification support for document review, biometric checks, and verification decisions. |

### Upsells & Ancillaries (12)

**Approach:** Partner APIs; attach to stay-extras / folio patterns already in HAIP where they exist; console only without contracts.

| Slug | Name | Notes |
|------|------|-------|
| `besafe-rate` | BeSafe Rate | Protected-rate and ancillary offer support for flexible booking and guest assurance products. |
| `blackhawk-network` | Blackhawk Network | Gift card and reward distribution support for guest incentives and ancillary programs. |
| `duve` | Duve | Guest app and upsell connectivity for pre-arrival offers, service requests, and operational handoff. |
| `oaky` | Oaky | Upsell platform connectivity for room upgrades, add-ons, and targeted pre-arrival offers. |
| `resortpass` | ResortPass | Day-use and amenity access connectivity for pools, spas, cabanas, and property experiences. |
| `rezdy` | Rezdy | Tours and activities booking connectivity for operators, availability, pricing, and reservations. |
| `tiqets` | Tiqets | Attraction and ticketing connectivity for guest experience offers and booking flows. |
| `tremendous` | Tremendous | Digital reward and payout support for guest incentives, compensation, and service recovery workflows. |
| `upsellguru` | UpsellGuru | Upgrade and ancillary bidding workflow support for pre-arrival revenue opportunities. |
| `viator-partner-api` | Viator Partner API | Tours and activities connectivity for inventory search, booking, and guest experience offers. |
| `welcome-pickups` | Welcome Pickups | Transfer booking support for airport rides, arrival details, and guest travel services. |
| `xola` | Xola | Experiences booking support for tours, activities, availability, and reservation workflows. |

### Housekeeping & Operations (3)

**Approach:** Partner task-sync; wire to HK ops surfaces if present; no invented HK vendor APIs.

| Slug | Name | Notes |
|------|------|-------|
| `duve-housekeeping-task-sync` | Duve Housekeeping Task Sync | Housekeeping task synchronization for guest requests, room readiness, and service follow-up. |
| `flexkeeping` | Flexkeeping | Housekeeping and staff operations connectivity for tasks, room status, maintenance, and team communication. |
| `quore` | Quore | Hotel operations integration for housekeeping, maintenance, requests, and property team workflows. |

### Channel Managers (2)

**Approach:** Meta/process rows — certification queue & mapping studio; docs + workflow, not fake CM HTTP.

| Slug | Name | Notes |
|------|------|-------|
| `channel-manager-cert-queue` | Channel manager partner certification queue | Partner application and certification queue surface for additional channel-manager connectivity beyond current adapters. |
| `channel-manager-mapping-studio` | Channel mapping studio (partner) | Partner-facing room/rate mapping studio surface required by multi-channel certification onboarding. |

### OTA Direct Connectivity (5)

**Approach:** Partner/cert; prefer existing channel adapters first; Rapid/Airbnb need partner access.

| Slug | Name | Notes |
|------|------|-------|
| `airbnb-partner-api` | Airbnb Partner API | Partner API pathway for property content, availability, pricing, and reservation exchange with Airbnb. |
| `expedia-rapid` | Expedia Rapid | Direct API connectivity for shopping, booking, itinerary retrieval, and reservation servicing through Expedia Rapid. |
| `trip-com-connect` | Trip.com Connect | Trip.com connectivity for inventory, rates, availability, reservation delivery, and booking updates. |
| `tripadvisor-instant-booking` | Tripadvisor Instant Booking | Instant Booking connectivity for availability, pricing, booking creation, and reservation delivery. |
| `vrbo-on-rapid` | Vrbo on Rapid | Vacation rental connectivity through Rapid-powered Vrbo shopping, booking, and reservation management flows. |

### Metasearch & Direct Booking (10)

**Approach:** Partner feeds + deep-link recipes; do not invent metasearch payloads.

| Slug | Name | Notes |
|------|------|-------|
| `google-hotel-content` | Google Hotel Content | Hotel content feed support for property details, amenities, images, and metadata shown across Google travel surfaces. |
| `google-hotel-prices` | Google Free Booking Links/Hotel Prices | Google hotel price feed and free booking link support for direct booking discovery. |
| `google-vacation-rentals` | Google Vacation Rentals | Vacation rental feed support for property content, availability, pricing, and direct booking links. |
| `kayak-hotels-search` | KAYAK Hotels Search | Hotel search feed support for availability, rates, deep links, and booking referral workflows. |
| `microsoft-advertising-hotel-ads` | Microsoft Advertising Hotel Ads | Hotel ads feed support for rates, availability, landing pages, and campaign measurement. |
| `pricepoint` | Pricepoint | Direct booking and metasearch support for pricing, availability, and conversion-oriented reservation flows. |
| `shr-windsurfer` | SHR/Windsurfer | Booking engine and distribution connectivity for Windsurfer-powered direct reservation experiences. |
| `tripadvisor-tripconnect` | TripAdvisor TripConnect | TripConnect support for hotel rates, availability, booking links, and performance reporting. |
| `trivago-conversion-api` | trivago Conversion API | Conversion reporting support for booking events attributed to trivago traffic. |
| `trivago-fastconnect` | trivago FastConnect | FastConnect support for hotel rates, availability, landing pages, and booking referral flows. |

### Revenue Management & Pricing (9)

**Approach:** Partner RMS; no invented pricing engine; console or outbound ARI hooks only with docs.

| Slug | Name | Notes |
|------|------|-------|
| `beonx` | BEONX | Revenue management support for demand intelligence, rate recommendations, and pricing workflows. |
| `beyond-pricing` | Beyond Pricing | Dynamic pricing support for vacation rental and lodging rates, demand signals, and rate pushes. |
| `diamo` | DIAMO | Revenue management connectivity for pricing recommendations and performance monitoring. |
| `duetto` | Duetto | Revenue strategy system connectivity for pricing recommendations, restrictions, and performance data. |
| `ideas` | IDeaS | Revenue management integration path for forecasts, pricing recommendations, and inventory controls. |
| `lighthouse-market-data` | Lighthouse Market Data | Market intelligence support for rate shopping, demand data, and pricing context. |
| `pricelabs` | PriceLabs | Dynamic pricing connectivity for short-term rental and hotel rates, minimum stays, and restrictions. |
| `roompricegenie` | RoomPriceGenie | Revenue management connectivity for recommended rates, pricing rules, and rate updates. |
| `wheelhouse` | Wheelhouse | Dynamic pricing support for rental rates, demand insights, and calendar-based rate updates. |

### BI & Analytics (2)

**Approach:** Partner BI — Demand360/Top-Report; not the Postgres recipe path already shipped.

| Slug | Name | Notes |
|------|------|-------|
| `amadeus-demand360` | Amadeus Demand360 | Market demand intelligence connectivity for forward-looking demand context and performance analysis. |
| `top-report` | Top-Report | Hotel reporting connectivity for performance dashboards, exports, and management analytics. |

### Automation Platforms (3)

**Approach:** Partner **app listing** (Zapier/Make/IFTTT). Webhook recipes already exist — do not duplicate as shipped clients.

| Slug | Name | Notes |
|------|------|-------|
| `ifttt-partner-app` | IFTTT Partner App listing | IFTTT partner applet/service listing for trigger-action workflows connected to HAIP events. |
| `make-partner-app` | Make Partner App listing | Official Make.com partner app listing and certified modules beyond generic HTTP webhooks. |
| `zapier-partner-app` | Zapier Partner App listing | Official Zapier partner app listing and certified triggers/actions beyond generic webhook catch. |

### Compliance Market Entry (paid/gated) (22)

**Approach:** See compliance-market-entry.md — paid/gated or feature-only registers; schedule by market entry; never claim free live filing.

| Slug | Name | Notes |
|------|------|-------|
| `austria-feratel-meldewesen` | Austria feratel Meldewesen | Tyrol/Burgenland tourism reporting — paid/gated market-entry pack. |
| `austria-gaesteverzeichnis` | Austria Gästeverzeichnis | Feature-only guest directory generate/retain; no authority API. |
| `belgium-gks-fdm` | Belgium GKS/FDM | Paid fiscal device path — schedule by market entry; not a free API connector. |
| `belgium-traveler-register` | Belgium traveler register | Feature-only traveler register generate/retain; no authority API. |
| `bulgaria-supto` | Bulgaria SUPTO | Fiscal device path — paid/gated market-entry pack. |
| `ecuador-siete-establishment` | Ecuador SIETE establishment-only | Establishment reporting feature pack — schedule by market entry. |
| `france-fiche-de-police` | France fiche de police | Feature-only police fiche generate/retain; no authority API. |
| `france-nf525-factur-x` | France NF525 + Factur-X/PDP | Paid cert / hardware path — schedule by market entry; not a free API connector. |
| `germany-meldeschein` | Germany Meldeschein | Feature-only guest form generate/retain; no authority API — not claimed free automated filing. |
| `greece-guest-book` | Greece Βιβλίο Πελατών | Feature-only guest book generate/retain; no authority API. |
| `italy-rt-corrispettivi` | Italy RT corrispettivi | Registratore Telematico hardware path — schedule by market entry. |
| `liechtenstein-guest-register` | Liechtenstein guest register | Feature-only local register generate/retain; no authority API. |
| `malta-guest-register` | Malta guest register | Feature-only guest register generate/retain; no authority API. |
| `netherlands-nachtregister` | Netherlands nachtregister | Feature-only night register generate/retain; no authority API. |
| `poland-kasa-fiskalna` | Poland kasa fiskalna | Fiscal cash register path — paid/gated market-entry pack. |
| `portugal-at-saft` | Portugal AT + SAF-T | Authority + SAF-T reporting — paid/gated market-entry pack. |
| `romania-amef` | Romania AMEF | Fiscal device path — paid/gated market-entry pack. |
| `san-marino-tourist-tax` | San Marino tourist tax remittance | Feature-only tax remittance workflow; no free automated filing claim. |
| `ses-hospedajes` | SES.Hospedajes | Spanish guest and lodging registration reporting pathway — market-entry gated compliance pack. |
| `slovakia-efaktura-2027` | Slovakia eFaktúra 2027 | Upcoming mandate — schedule by market entry; not claimed free. |
| `sweden-control-unit` | Sweden control unit | Control unit requirement — paid/gated market-entry pack. |
| `uk-hotel-records` | UK Hotel Records | Feature-only guest records retention workflow; no authority API. |

---

## Verify counts

```bash
node -e "const fs=require('fs');const t=fs.readFileSync('packages/database/src/schema/integration-registry-seed.ts','utf8');const n=[...t.matchAll(/status: 'planned'/g)].length;console.log('planned',n);"
```

If the count drifts from this file’s header, regenerate the inventory from the seed — seed wins.

## Related docs

- [INTEGRATIONS.md](../INTEGRATIONS.md) — catalog + status meanings
- [wave3-partner-surface.md](../integrations/wave3-partner-surface.md) — what already shipped in Wave 3 Tier A/B
- [compliance-market-entry.md](../integrations/compliance-market-entry.md) — Compliance-22
- [wave3-fiscal-guest-reg.md](../integrations/wave3-fiscal-guest-reg.md) — console fiscal/guest-reg already wired
- [unthin-backlog.md](./unthin-backlog.md) — ops/loyalty depth (separate from this catalog backlog)
