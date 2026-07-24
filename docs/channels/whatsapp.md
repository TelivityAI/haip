# WhatsApp as a guest messaging channel (research brief)

**Status:** Research only — not implemented.  
**Audience:** Owner decision + NestJS adapter design.  
**Date:** 2026-07-24  
**Context:** HAIP already has email guest-comms (`guest-comms` agent + `EmailService`) and SMS via `NotificationService` / `SmsProvider`. Build plan lists WhatsApp as later guest-journey work (`HAIP_BUILD_PLAN.md`).

This brief maps Meta’s WhatsApp Business Platform rules onto HAIP’s existing notification abstraction. It does **not** invent hotel domain concepts beyond the lifecycle types already in guest-comms (`confirmation`, `pre_arrival`, day-of, `post_stay`).

---

## Executive recommendation

| Decision | Recommendation |
|----------|----------------|
| MVP | **Outbound transactional templates only** (utility: confirmation / pre-arrival / ops alerts). No free-form staff inbox yet. |
| Access path | Prefer **one BSP** for v1 if Twilio is already the SMS reference adapter; otherwise **direct Cloud API** if you want zero BSP markup and accept Meta-ops burden. |
| “Self-host WhatsApp” | **Do not.** On-Premises API is deprecated; Cloud API is Meta-hosted. The real fork is **direct Cloud API vs BSP**, not self-host vs cloud. |
| Two-way | Phase 2: inbound webhooks → staff notifications / service-request stubs. |

---

## 1. Official options: Cloud API (Meta) vs BSPs

### Clarification (2025–2026)

- **WhatsApp Business Platform** = umbrella for official programmatic messaging.
- **Cloud API** = Meta-hosted Graph API implementation — **only supported path for new integrations** after On-Premises API retirement (Meta docs: [Cloud vs On-Prem](https://developers.facebook.com/docs/whatsapp/cloud-vs-onprem/)).
- **BSP / Solution Partner** = Meta-authorized partner that sits on Cloud API and adds onboarding, billing consolidation, sometimes inbox/UI. Same Meta message rules and (usually) same Meta rates underneath.

You **can** integrate Cloud API directly as a developer (no BSP required). Some hospitality glossaries still claim “must use a BSP” — that is outdated for Cloud API.

### Path A — Direct Meta Cloud API

| | |
|--|--|
| **What you get** | `POST https://graph.facebook.com/vXX.X/{phone-number-id}/messages`, webhooks to your URL, WABA + phone number in Meta Business Manager. |
| **Setup** | Meta app + WhatsApp use case, WABA, business phone number, system-user permanent token, webhook verify + subscribe (`messages`, optionally `user_preferences`). [Get started](https://developers.facebook.com/docs/whatsapp/cloud-api/get-started) |
| **Pros (hotels / HAIP)** | No BSP per-message markup; full control; multi-tenant can use webhook overrides per WABA/number; aligns with API-first PMS. |
| **Cons** | You own token rotation, template lifecycle in WhatsApp Manager, quality rating, display-name verification, webhook retries/dedup, Meta billing localization (IN/BR), support is docs-only. Multi-property onboarding is manual unless you become a Tech Provider / use Embedded Signup. |

### Path B — BSP on top of Cloud API

| BSP | Fit for HAIP | Pros | Cons |
|-----|--------------|------|------|
| **Twilio** | Strong if SMS already uses Twilio | Same account/SDK pattern as `TwilioSmsProvider`; Content Template Builder; inbound webhooks mirror SMS form posts; [Twilio WhatsApp overview](https://www.twilio.com/docs/whatsapp/api) | Platform fee on messages (commonly cited ~USD 0.005 + Meta); ContentSid model differs from Meta native template name/language |
| **360dialog** | Strong for EU GDPR-minded operators | Pass-through Meta fees (no message markup); Cloud-API-shaped Messaging API (`waba-v2.360dialog.io`); Partner API for multi-client onboarding; [docs](https://docs.360dialog.com/docs/messaging) | Monthly per-number platform fee; another vendor beside Twilio SMS |
| **Bird (MessageBird)** | Mid-market + inbox | Productized inbox/automation if hotels want UI outside HAIP | Markup / subscription; less “thin adapter” |
| **Vonage** | Similar to Twilio (Messages API) | Unified Messages API; PMP aligned with Meta Jul 2025; [Vonage WhatsApp](https://developer.vonage.com/en/messages/concepts/whatsapp) | Limited Availability historically; another credentials model |
| **Infobip / others** | Enterprise multi-channel | Regional coverage, compliance tooling | Heavier commercial stack than HAIP’s thin SMS pattern |

### Hotel-specific tradeoffs

| Concern | Direct Cloud API | BSP (esp. Twilio / 360dialog) |
|---------|------------------|-------------------------------|
| Per-property WABA / number | You provision in Meta BM; store IDs on property config | BSP often provisions; store BSP keys + Meta IDs |
| Front-desk two-way inbox | Must build in HAIP (or external) | Some BSPs include inbox (pay for product you may not want if HAIP owns desk) |
| Cost at low volume (boutique) | Meta rates only | Platform fee may dominate |
| Cost at high volume (chain) | Best unit economics | Twilio-style markup compounds; 360dialog pass-through better |
| Ops burden for self-hosters | Higher | Lower |

---

## 2. Template vs session messages; 24h window; opt-in

### Message types

| Kind | When allowed | Pre-approval | Meta charge (effective Jul 1, 2025) |
|------|--------------|--------------|-------------------------------------|
| **Template** (`type: template`) | Anytime (with opt-in); **required** outside customer service window | Yes — Meta review | Charged on **delivery**, by category + recipient country |
| **Service / session** (text, media, interactive, etc.) | Only inside open **customer service window (CSW)** | No | **Free** |
| **Utility template inside open CSW** | Inside CSW | Yes (template still approved) | **Free** |

Sources: [Service / conversation types](https://developers.facebook.com/docs/whatsapp/conversation-types/), [Pricing](https://developers.facebook.com/docs/whatsapp/pricing/), [Template fundamentals](https://developers.facebook.com/docs/whatsapp/business-management-api/message-templates/).

### 24-hour customer service window (CSW)

- Opens when the **user** messages or calls the business.
- Resets on each subsequent inbound user message/call.
- While open: free-form service messages + free utility templates.
- When closed: **templates only**.
- Separate concept: **Free Entry Point (FEP)** — 72h free window after certain click-to-WhatsApp ad flows (see Meta pricing docs). Rare for classic hotel booking unless ads.

### Template categories (map to HAIP guest-comms)

| Meta category | Typical hotel use (existing HAIP email types) | Notes |
|---------------|-----------------------------------------------|--------|
| **Utility** | `confirmation`, `pre_arrival`, check-in instructions, payment/folio alerts, late checkout confirmation | Prefer this for transactional PMS traffic |
| **Authentication** | OTP / magic link if ever on WhatsApp | Short TTL (default ~10 min) |
| **Marketing** | `post_stay` review asks, upsell promos, offers | Highest rates; needs marketing consent + Meta stop/resume |

Mis-categorizing a marketing body as utility risks policy enforcement and quality rating damage — Meta’s review assigns category; businesses must accept the charged category at send time ([pricing](https://developers.facebook.com/docs/whatsapp/pricing/)).

### Opt-in (Meta policy, Nov 2024 update)

From [Get opt-in for WhatsApp](https://developers.facebook.com/docs/whatsapp/overview/getting-opt-in/):

1. Guest has given a mobile number.
2. Business has opt-in that they wish to receive subsequent messages/calls from **that business** (named).
3. Opt-in may be **general** (not WhatsApp-specific) **if** local law allows — but Meta still requires clear business name + intent, and local law (e.g. EU ePrivacy / GDPR) may require **channel-specific** consent.

Supported collection methods (examples): website, SMS, IVR, in person / paper.

**HAIP implication:** Today `guests.gdprConsentMarketing` gates marketing email/SMS. WhatsApp needs at least:

- Channel/capability consent for **transactional** WhatsApp (or documented mapping from booking T&Cs if counsel agrees), **and**
- Marketing flag for Marketing templates (reuse or extend `gdprConsentMarketing` / add `whatsappOptIn` — **owner decision**).

---

## 3. NestJS integration architecture (match SMS pattern)

### Current SMS pattern (shipped)

```
ReservationMessagingService / guest-comms
        │
        ▼
NotificationService.sendSms(propertyId, to, body)
        │
        ├── TwilioSmsProvider  (SmsProvider)
        └── ConsoleSmsProvider (fallback)
        │
        ▼
WebhookService.emit('guest.communication_sent' | 'reservation.message_sent')
```

Interface today (`apps/api/src/modules/notifications/notification-provider.interface.ts`):

- `SmsProvider`: `name`, `isConfigured()`, `send(SmsMessage) → SmsResult`
- Env-global Twilio credentials (not yet property-scoped)

### Proposed WhatsApp layer

Keep SMS and WhatsApp as **sibling transports** under notifications (same audit/quota/GDPR gates), not a fork of EmailService.

```
                    ┌─────────────────────────────────────┐
                    │     NotificationService             │
                    │  sendSms / sendWhatsAppTemplate /   │
                    │  sendWhatsAppSession (phase 2)      │
                    └──────────────┬──────────────────────┘
           ┌───────────────────────┼───────────────────────┐
           ▼                       ▼                       ▼
    SmsProvider[]          WhatsAppProvider[]        Console* fallbacks
    (Twilio SMS)           (Cloud API / Twilio WA /
                            360dialog / …)
           │                       │
           └───────────┬───────────┘
                       ▼
              propertyId-scoped audit + rate limit
```

**Controller surface (later):**

- Extend `ComposeMessageDto.channel` with `'whatsapp'` (today: `'email' | 'sms'`).
- Guest-comms agent: optional channel preference / property default.
- Public webhook controller(s): `/api/v1/notifications/whatsapp/webhooks/:provider` (signature verify; resolve `propertyId` from phone_number_id → config map — **never** from attacker-controlled guest id alone).

### Adapter interface sketch (TypeScript only)

```typescript
/**
 * WhatsApp provider abstraction — mirrors SmsProvider.
 * Property-scoped credentials are passed in (or resolved by the service
 * before call); adapters must not invent propertyId from message content.
 */

export type WhatsAppTemplateCategory = 'utility' | 'authentication' | 'marketing';

export interface WhatsAppTemplateRef {
  /** Logical HAIP key, e.g. 'pre_arrival' — mapped per property to provider template id/name */
  templateKey: string;
  /** BCP-47 / WhatsApp language code, e.g. 'en', 'en_US' */
  language: string;
  /** Named or positional variables — adapter normalizes to provider shape */
  variables: Record<string, string>;
  /** Expected Meta category for GDPR + cost gates (caller asserts) */
  category: WhatsAppTemplateCategory;
}

export interface WhatsAppOutboundTemplate {
  propertyId: string;
  /** E.164 without whatsapp: prefix; adapter may add provider prefix */
  to: string;
  template: WhatsAppTemplateRef;
  /** Optional correlation for webhooks (reservationId, guestId) */
  context?: {
    reservationId?: string;
    guestId?: string;
  };
}

export interface WhatsAppOutboundSession {
  propertyId: string;
  to: string;
  /** Free-form — ONLY valid inside open CSW; provider may reject otherwise */
  body: string;
  mediaUrl?: string;
}

export interface WhatsAppSendResult {
  sent: boolean;
  messageId?: string;
  provider: string;
  error?: string;
  /** Provider-specific raw id for delivery webhooks */
  providerMessageId?: string;
}

export interface WhatsAppInboundMessage {
  provider: string;
  /** Resolved by phone_number_id / BSP account → property config */
  propertyId: string;
  from: string; // E.164 / wa_id
  providerMessageId: string;
  timestamp: Date;
  type: 'text' | 'image' | 'button' | 'interactive' | 'unknown';
  text?: string;
  raw?: unknown;
}

export interface WhatsAppMarketingPreferenceEvent {
  propertyId: string;
  waId: string;
  preference: 'stop' | 'resume';
  timestamp: Date;
}

export interface WhatsAppProvider {
  readonly name: string;

  /** True when this adapter can send for the given property config */
  isConfigured(propertyConfig: WhatsAppPropertyConfig): boolean;

  sendTemplate(
    config: WhatsAppPropertyConfig,
    message: WhatsAppOutboundTemplate,
  ): Promise<WhatsAppSendResult>;

  /** Phase 2 — session/free-form inside CSW */
  sendSession?(
    config: WhatsAppPropertyConfig,
    message: WhatsAppOutboundSession,
  ): Promise<WhatsAppSendResult>;

  /**
   * Verify webhook authenticity (Meta HMAC / Twilio signature / BSP secret)
   * and normalize to inbound DTOs. Return [] if not this provider's payload.
   */
  parseInboundWebhook?(
    headers: Record<string, string | string[] | undefined>,
    body: unknown,
    /** Lookup: phoneNumberId | displayPhone → property config */
    resolveProperty: (hint: {
      phoneNumberId?: string;
      displayPhoneNumber?: string;
      wabaId?: string;
    }) => Promise<WhatsAppPropertyConfig | null>,
  ): Promise<{
    messages: WhatsAppInboundMessage[];
    preferences: WhatsAppMarketingPreferenceEvent[];
    /** Delivery/read receipts — optional audit */
    statuses?: Array<{ providerMessageId: string; status: string }>;
  }>;
}

/** DI token parallel to SMS_PROVIDERS */
export const WHATSAPP_PROVIDERS = Symbol('WHATSAPP_PROVIDERS');
```

**Service methods (sketch):**

```typescript
// NotificationService extensions (conceptual)
sendWhatsAppTemplate(propertyId, to, templateKey, variables, opts?: { isMarketing?: boolean })
// → load WhatsAppPropertyConfig by propertyId
// → GDPR: marketing templates require consent; transactional require whatsapp opt-in policy
// → quota (reuse SMS-style per-property limiter)
// → provider.sendTemplate
// → emit guest.communication_sent { channel: 'whatsapp', … }
```

---

## 4. Inbound guest replies → staff / service requests

### Webhook plumbing (Meta)

- Subscribe to field `messages` (inbound + outbound status). Optionally `user_preferences` for marketing stop/resume.
- Endpoint must answer webhook verification challenge; return 200 quickly; Meta retries up to ~7 days on failure ([Webhooks](https://developers.facebook.com/docs/whatsapp/cloud-api/guides/set-up-webhooks/)).
- Resolve tenant by `metadata.phone_number_id` → property WhatsApp config (**required** multi-tenancy pattern — do not derive property from guest phone alone without verifying the destination number belongs to that property).

### HAIP fan-out (phase 2)

```
Provider webhook
    → WhatsAppProvider.parseInboundWebhook
    → emit 'guest.whatsapp_message_received' (property-scoped)
    → StaffNotificationService.create({
         type: 'guest_whatsapp',
         title: 'WhatsApp from {guest or phone}',
         message: text snippet,
         sourceEntityType: 'reservation' | 'guest',
         …
       })
    → (optional) create service request / CRM note if product decides
    → EventsGateway broadcast (existing staff notification realtime)
```

**Matching guest/reservation:** E.164 normalize `from` / `wa_id` → guests with phone at property via reservation link (guest table is cross-property; API must scope by reservation at `propertyId` — same multi-tenancy rule as guests).

**Auto-replies:** Out of MVP. If guest replies to a pre-arrival template, CSW opens → staff can later send free-form via `sendSession`.

**Twilio note:** Inbound WhatsApp webhooks reuse Messaging webhook form encoding with `whatsapp:+…` addresses ([Twilio webhook request](https://www.twilio.com/docs/messaging/guides/webhook-request)).

---

## 5. Cost & compliance (high level)

### Cost layers

1. **Meta per-message fees** (templates delivered) — by category + country; conversation-based pricing **deprecated** Jul 1, 2025 ([Pricing](https://developers.facebook.com/docs/whatsapp/pricing/)).
2. **BSP platform fee / markup** (if any) — Twilio-style per-message fee, 360dialog-style monthly per number, Bird-style subscription+markup.
3. **HAIP engineering / ops** — template maintenance, quality monitoring, webhook infra.

**Hotel cost intuition:** Pre-arrival utility templates to guests in DE/UK/US are the recurring bill. Keep post-stay / upsell as Marketing and volume-gate them. Prefer opening CSW via guest reply so follow-ups are free session messages.

Official rate cards: linked from Meta pricing page (USD/EUR/GBP CSVs; updated quarterly with notice calendar).

### GDPR / EU (high level — not legal advice)

| Topic | HAIP today | WhatsApp add |
|-------|------------|--------------|
| Marketing opt-out | `gdprConsentMarketing` on guest; compose/send blocks when false | Map Meta `user_preferences` `stop`/`resume` → same (or WA-specific) flag; [user_preferences ref](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/user_preferences) |
| Lawful basis | Booking transactional vs marketing | Utility templates ≈ legitimate interest / contract performance **if** counsel agrees; marketing still needs consent under ePrivacy in many EU states |
| Data processor | Self-hosted SMTP / Twilio SMS | Meta + optional BSP are processors — DPA / SCCs; store minimal message content; audit via existing webhook events |
| Retention | No persistent message-log table yet (compose/send only) | Decide before two-way: inbound storage = personal data |
| Right to object / erase | Guest GDPR fields | Honor Meta marketing stop even if guest row still has old consent |

Meta policy still requires opt-in before messaging; EU law may be stricter than Meta’s “general opt-in” allowance — **default to explicit WhatsApp (or messaging) consent at booking**.

---

## 6. MVP slice: outbound templates only vs two-way

### Recommended MVP (outbound transactional templates only)

| In | Out |
|----|-----|
| Property WhatsApp config + encrypted credentials | Staff WhatsApp inbox UI |
| `WhatsAppProvider` + Cloud API **or** Twilio WA adapter + console fallback | Free-form `sendSession` |
| Template map for `confirmation` / `pre_arrival` (utility) | Marketing templates / post-stay WA |
| `NotificationService.sendWhatsAppTemplate` + compose channel `whatsapp` | Media-rich interactive flows |
| Delivery status webhook → audit (optional thin) | Service-request auto-create from inbound |
| GDPR gates + rate limit | Multi-BSP matrix |

**Why:** Guest-comms already drafts lifecycle copy; WhatsApp only needs approved Meta templates + send path. Matches “guest journey depth” note (WhatsApp later) without building a messaging product.

### Phase 2 — two-way

- Inbound webhook → staff notifications.
- `sendSession` when CSW open (store `cswExpiresAt` per wa_id+property from last inbound).
- Optional: button templates for “Request late checkout” → create service request.

### Phase 3 — marketing

- Marketing templates + `user_preferences` sync + upsell/post-stay WA aligned with email `upsellEnabled` / review links.

---

## 7. Config model (property-level)

SMS today is **process env** (global). WhatsApp for multi-tenant hotels should be **per property** (each hotel’s WABA / number / brand).

### Suggested shape (store in `properties.settings.whatsapp` or dedicated table)

```typescript
export interface WhatsAppPropertyConfig {
  propertyId: string;
  enabled: boolean;
  /** 'meta_cloud' | 'twilio' | '360dialog' | 'vonage' | 'bird' | 'console' */
  provider: string;

  /** Meta WABA id (all Cloud API paths) */
  wabaId?: string;
  /** Required for Graph API send path */
  phoneNumberId?: string;
  displayPhoneNumber?: string; // E.164

  /** Direct Cloud API */
  accessTokenRef?: string; // vault / sealed secret id — never log raw token

  /** BSP-specific */
  bspAccountSid?: string;
  bspAuthTokenRef?: string;
  bspApiKeyRef?: string;      // e.g. 360dialog D360-API-KEY
  twilioWhatsAppFrom?: string; // whatsapp:+E.164
  twilioMessagingServiceSid?: string;

  webhookVerifyTokenRef?: string;
  webhookAppSecretRef?: string; // Meta X-Hub-Signature-256

  /**
   * Map HAIP logical template keys → provider template identity.
   * Cloud API: name + language code.
   * Twilio: ContentSid (HX…).
   */
  templates: {
    confirmation?: { nameOrContentSid: string; language: string; category: 'utility' };
    pre_arrival?: { nameOrContentSid: string; language: string; category: 'utility' };
    post_stay?: { nameOrContentSid: string; language: string; category: 'marketing' };
    // …property may add ops keys later
  };

  defaultLanguage: string;
  /** If true, guest-comms may auto-send WA when channel enabled + opt-in */
  autoSendLifecycle?: boolean;
}
```

**Secrets:** Do not put raw tokens in JSON settings without encryption-at-rest; mirror how channel connectors store DerbySoft secrets (`docs/channels/derbysoft.md` pattern).

**Routing key for inbound:** unique index on `(provider, phoneNumberId)` → `propertyId`.

---

## 8. Open questions for owner

1. **BSP vs direct Cloud API?**  
   - Default lean: **Twilio WhatsApp** if keeping one vendor with SMS; **360dialog** if EU + pass-through Meta fees; **direct Cloud API** if maximizing control / minimizing markup and accepting Meta ops.

2. **“Self-host Cloud API”?**  
   - **No viable on-prem API** for new work. Clarify: “self-host” can only mean “HAIP hosts webhook + adapter, Meta hosts messaging” — not running WhatsApp servers.

3. **Single WABA for the HAIP SaaS tenant vs per-property WABA?**  
   - Brand/compliance usually want **per property (or per brand) number**. Platform Tech Provider + Embedded Signup is a larger project.

4. **Consent model:** Reuse `gdprConsentMarketing` only, or add `whatsappOptIn` / `gdprConsentTransactionalMessaging`?

5. **MVP channel set:** Utility confirmation + pre-arrival only, or also day-of / payment?

6. **Inbound SLA:** Staff notification only vs create service requests automatically (needs product rules — do not invent without KB)?

7. **Template ownership:** Hotels submit templates in Meta/BSP UI, or HAIP ships default English templates they copy?

8. **Pricing responsibility:** Does the self-hoster bring their own Meta/BSP billing (like Twilio SMS today), or will a hosted HAIP cloud ever resell messaging?

9. **Persist message log?** Current reservation compose explicitly has no message-log table — two-way almost certainly needs one for GDPR access/erasure.

10. **Quality / throughput:** Who monitors Meta quality rating and messaging limits when a property spams marketing?

---

## Source index (primary)

| Topic | URL |
|-------|-----|
| Cloud vs On-Prem | https://developers.facebook.com/docs/whatsapp/cloud-vs-onprem/ |
| Cloud API get started | https://developers.facebook.com/docs/whatsapp/cloud-api/get-started |
| Webhooks setup | https://developers.facebook.com/docs/whatsapp/cloud-api/guides/set-up-webhooks/ |
| Service messages / CSW | https://developers.facebook.com/docs/whatsapp/conversation-types/ |
| Templates | https://developers.facebook.com/docs/whatsapp/business-management-api/message-templates/ |
| Pricing (per-message) | https://developers.facebook.com/docs/whatsapp/pricing/ |
| Opt-in policy | https://developers.facebook.com/docs/whatsapp/overview/getting-opt-in/ |
| Marketing user_preferences | https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/user_preferences |
| Twilio WhatsApp | https://www.twilio.com/docs/whatsapp/api |
| Twilio Content templates | https://www.twilio.com/docs/content/send-templates-created-with-the-content-template-builder |
| 360dialog Messaging | https://docs.360dialog.com/docs/messaging |
| Vonage WhatsApp | https://developer.vonage.com/en/messages/concepts/whatsapp |

---

## HAIP code touchpoints (when implementing)

| Area | Path |
|------|------|
| SMS interface | `apps/api/src/modules/notifications/notification-provider.interface.ts` |
| SMS dispatcher | `apps/api/src/modules/notifications/notification.service.ts` |
| Twilio SMS adapter | `apps/api/src/modules/notifications/providers/twilio-sms.provider.ts` |
| Compose email/SMS | `apps/api/src/modules/reservation/reservation-messaging.service.ts` |
| Lifecycle email types | `apps/api/src/modules/agent/guest-comms/guest-communication.models.ts` |
| Staff realtime notify | `apps/api/src/modules/staff-notifications/staff-notification.service.ts` |
| Marketing consent column | `packages/database/src/schema/guest.ts` (`gdprConsentMarketing`) |
