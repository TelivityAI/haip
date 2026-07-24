# Integration recipes

Short, practical how-tos for wiring HAIP to common automation and back-office tools. Each recipe points at real REST paths on your HAIP instance (`/api/v1/...`).

For the full integration catalog, see **[Integration catalog](../INTEGRATIONS.md)**.

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
| [Serbia fiscal & guest registration](serbia-fiscal.md) | Property fiscal config, `invoice.requested`, eTurista check-in hooks |
| [SendGrid email](sendgrid-email.md) | Transactional email via SendGrid API |
| [Bird SMS](bird-sms.md) | Guest SMS via Bird/MessageBird |
| [Review sources (Google / TripAdvisor)](review-sources.md) | Pull external reviews into HAIP |

## Base URL

Replace `https://your-haip.example.com` with your deployment. Interactive API reference: `https://your-haip.example.com/docs` (when enabled).
