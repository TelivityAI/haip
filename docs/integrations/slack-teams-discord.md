# Post HAIP events to Slack, Microsoft Teams, or Discord

Chat platforms do not receive HAIP webhooks directly. Typical pattern: **HAIP → automation catch URL → format message → incoming webhook URL** for your chat app.

## Incoming webhook URLs (chat side)

Create an incoming webhook in each product (admin/settings in your workspace):

| Platform | Docs (incoming webhook) |
|----------|-------------------------|
| Slack | [Sending messages using incoming webhooks](https://api.slack.com/messaging/webhooks) |
| Microsoft Teams | [Create incoming webhooks](https://learn.microsoft.com/en-us/microsoftteams/platform/webhooks-and-connectors/how-to/add-incoming-webhook) |
| Discord | [Webhook resource](https://discord.com/developers/docs/resources/webhook) |

Store the webhook URL as a secret in your automation tool, not in HAIP.

## HAIP side

1. Subscribe to events (**[Webhooks & events](../webhooks.md#subscribing)**) with `callbackUrl` pointing to n8n, Make, or Zapier ([recipes in this folder](README.md)).
2. Verify `X-HAIP-Signature` before trusting the body.
3. Map `eventType` and key fields from `data` into a short human-readable line.

Example message templates (adjust to your ops vocabulary):

- `reservation.checked_in` — “Room ready: reservation {{entityId}} at property {{propertyId}}”
- `folio.settled` — “Folio settled: {{entityId}}”
- `webhook_delivery_failed` — surface from staff notifications or monitor subscription deliveries

## HTTP POST to chat

**Slack** — JSON body:

```json
{ "text": "HAIP reservation.checked_in — entity {{entityId}}" }
```

**Teams** — MessageCard or Adaptive Card JSON (see Microsoft docs for your connector type).

**Discord** — JSON body:

```json
{ "content": "HAIP folio.settled — {{entityId}}" }
```

Use an **HTTP Request** module (Make/n8n) or **Webhooks by Zapier** action step with method POST and `Content-Type: application/json`.

## Tips

- Keep messages free of guest PII unless your chat workspace is approved for it; use `entityId` and link to the HAIP dashboard instead.
- Rate-limit noisy events (`housekeeping.*`, high-volume channel sync) with filters on `eventType`.
- Failed chat posts do not affect HAIP delivery if your automation still returns 2xx to HAIP; log chat errors separately.
