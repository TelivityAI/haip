# Infobip, Vonage Messages, and Telegram guest messaging

HAIP outbound guest SMS uses a pluggable **SmsProvider** adapter (Twilio reference + console fallback). Wave 2 adds **Infobip** and **Vonage Messages** (SMS channel), plus **Telegram Bot** for chat-based guest notifications.

WhatsApp remains on the existing Twilio adapter — see [WhatsApp channel notes](../channels/whatsapp.md).

See also [Guest Messaging](../INTEGRATIONS.md#guest-messaging) in the integration catalog.

## Select providers

Set on the API container (see [`.env.example`](../../.env.example)):

| Variable | Values | Notes |
|----------|--------|--------|
| `SMS_PROVIDER` | `twilio`, `infobip`, `vonage`, `console` | When unset, HAIP auto-picks the first configured vendor in order: twilio → infobip → vonage → console |
| `TELEGRAM_PROVIDER` | `telegram`, `console` | Default `telegram` when unset; falls back to console if `TELEGRAM_BOT_TOKEN` is missing |

**Examples**

```bash
# Infobip SMS
SMS_PROVIDER=infobip
INFOBIP_API_KEY=...
INFOBIP_SMS_FROM=HotelName

# Vonage Messages (SMS)
SMS_PROVIDER=vonage
VONAGE_API_KEY=...
VONAGE_API_SECRET=...
VONAGE_SMS_FROM=15551230000

# Telegram bot (guest chat id from your bot / deep link flow)
TELEGRAM_BOT_TOKEN=123456:ABC...
TELEGRAM_PROVIDER=telegram
```

When credentials for a selected vendor are missing, HAIP falls back to the **console** adapter (message logged, `sent: false`).

## API endpoints

All routes require auth (unless `AUTH_ENABLED=false`) and roles `admin`, `front_desk`, or `night_auditor`.

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/v1/notifications/sms` | SMS via active `SMS_PROVIDER` |
| `POST` | `/api/v1/notifications/telegram` | Telegram via configured bot |
| `POST` | `/api/v1/notifications/whatsapp` | WhatsApp (Twilio / console — unchanged) |

Request bodies include required `propertyId` (tenant scope). SMS and Telegram share the per-property outbound rate limit (`SMS_RATE_LIMIT_MAX` / `SMS_RATE_LIMIT_WINDOW_MS`).

### SMS body

```json
{
  "propertyId": "11111111-1111-1111-1111-111111111111",
  "to": "+15551234567",
  "body": "Your room is ready."
}
```

### Telegram body

```json
{
  "propertyId": "11111111-1111-1111-1111-111111111111",
  "to": "123456789",
  "body": "Welcome — reply here if you need anything.",
  "parseMode": "HTML"
}
```

`to` is the Telegram **chat id** (guests must start the bot or join via your property’s deep link so you know their chat id).

## Infobip

| Env | Purpose |
|-----|---------|
| `INFOBIP_API_KEY` | API key (`Authorization: App …`) |
| `INFOBIP_SMS_FROM` | Sender id / alphanumeric originator |
| `INFOBIP_BASE_URL` | Optional API base (default `https://api.infobip.com`) |

Uses Infobip [advanced text message](https://www.infobip.com/docs/api/channels/sms/send-sms-message) (`POST /sms/2/text/advanced`).

## Vonage Messages

| Env | Purpose |
|-----|---------|
| `VONAGE_API_KEY` | API key |
| `VONAGE_API_SECRET` | API secret |
| `VONAGE_SMS_FROM` | Sender number or id |
| `VONAGE_MESSAGES_URL` | Optional override (default `https://api.nexmo.com/v1/messages`) |

Uses Vonage [Messages API](https://developer.vonage.com/en/messages/overview) with `channel: "sms"`.

## Telegram Bot

| Env | Purpose |
|-----|---------|
| `TELEGRAM_BOT_TOKEN` | Bot token from [@BotFather](https://core.telegram.org/bots#botfather) |

Uses [sendMessage](https://core.telegram.org/bots/api#sendmessage). Operational alerts and guest lifecycle copy should avoid unnecessary PII in chat logs.

## Audit & webhooks

Successful and failed dispatches emit `guest.communication_sent` on the property webhook stream with `channel` (`sms`, `telegram`, or `whatsapp`), `provider`, and `success`.

## Twilio SMS (reference)

Unchanged — configure `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` and either set `SMS_PROVIDER=twilio` or leave `SMS_PROVIDER` unset with Twilio credentials present.
