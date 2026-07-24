# Integration recipes

Short, practical how-tos for wiring HAIP to common automation and back-office tools. Each recipe points at real REST paths on your HAIP instance (`/api/v1/...`).

For the full integration catalog, see **[Integration catalog](../INTEGRATIONS.md)**.

**Shipped demos (one command):** [`integrations/demos/`](../../integrations/demos/) — `./integrations/demos/run.sh stripe` (or `all`). Turns the Integrations toggle on and wires mock/console paths without vendor keys.

For event delivery (signatures, payloads, retries, subscriptions), start with **[Webhooks & events](../webhooks.md)**.

## Recipes

| Recipe | What it covers |
|--------|----------------|
| [Webhooks in n8n](webhooks-n8n.md) | Catch HMAC-signed HAIP events |
| [Webhooks in Make](webhooks-make.md) | Same pattern on Make.com |
| [Webhooks in Zapier](webhooks-zapier.md) | Webhooks by Zapier catch |
| [Slack, Teams, Discord](slack-teams-discord.md) | Post HAIP events to chat incoming webhooks |
| [Connect API key](connect-api-key.md) | `x-api-key` auth, OpenAPI, subscriptions |
| [Folio inbound (POS)](folio-inbound-pos.md) | Post incidental charges from any POS |
| [Accounting CSV](accounting-csv.md) | Revenue journal / trial balance export |
| [BI on Postgres](bi-postgres.md) | Read-only DB access for Metabase, Grafana, etc. |
| [iCal calendar bridge](ical-calendar-bridge.md) | Planned calendar sync (Airbnb, Vrbo, Google Calendar) |
| [Infobip, Vonage, Telegram](messaging-infobip-vonage-telegram.md) | Guest SMS (Infobip / Vonage) and Telegram bot notifications |
| [Serbia fiscal](serbia-fiscal.md) | SUF/ESIR + eTurista console providers and fiscal config |
| [fiskaly SIGN AT](fiskaly-sign-at.md) | Austrian RKSV console fiscal provider key |
| [Wave 3 fiscal & guest-reg](wave3-fiscal-guest-reg.md) | Country-pack console provider keys (Brazil excluded) |
| [Wave 3 partner surface](wave3-partner-surface.md) | Registry status for partner/cert Wave 3 buckets |
| [Compliance market entry](compliance-market-entry.md) | Paid/gated and feature-only packs — never claimed free |
| [Beds24 & Channex](channel-beds24-channex.md) | Channel manager adapters |
| [Payments (Adyen/Mollie/Square/Braintree)](payments-adyen-mollie-square-braintree.md) | Additional payment gateways |
| [Door locks](door-locks-nuki-ttlock-salto.md) | Nuki, TTLock, Salto KS |
| [SendGrid email](sendgrid-email.md) | Transactional email provider |
| [WhatsApp Cloud](whatsapp-cloud.md) | Meta WhatsApp Cloud API provider |
| [Mailgun & SES](mailgun-ses.md) | Mailgun + Amazon SES gateway email providers |
| [Bird SMS](bird-sms.md) | Bird messaging provider |
| [Review sources](review-sources.md) | Google / TripAdvisor review stubs |

## Base URL

Replace `https://your-haip.example.com` with your deployment. Interactive API reference: `https://your-haip.example.com/docs` (when enabled).
