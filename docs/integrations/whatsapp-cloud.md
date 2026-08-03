# WhatsApp Cloud API

Meta WhatsApp Cloud API for guest WhatsApp messages via HAIP notifications.

## Provider

| Concern | Value |
|---------|--------|
| Provider name | `whatsapp-cloud` |
| Catalog slug | `whatsapp-cloud-api` |

Registered ahead of Twilio WhatsApp. The first configured non-console WhatsApp provider wins.

## Env

```bash
WHATSAPP_CLOUD_TOKEN=EAAB...
WHATSAPP_CLOUD_PHONE_NUMBER_ID=1234567890
# optional
WHATSAPP_CLOUD_API_VERSION=v21.0
```

Without credentials, WhatsApp falls through to Twilio (if configured) or console.

## Demo

```bash
./integrations/demos/run.sh whatsapp-cloud-api
```

## API

`POST /api/v1/notifications/whatsapp?propertyId=` — same path as Twilio WhatsApp.

## Go live

See [GO_LIVE.md](../../integrations/demos/whatsapp-cloud-api/GO_LIVE.md).
