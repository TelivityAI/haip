# Catch HAIP webhooks in Zapier

Zapier’s **Webhooks by Zapier** trigger can receive HAIP event POSTs when you do not need a custom server.

## Zapier plan note

Zapier’s free tier limits how many tasks run per month and which premium apps are available. Webhooks by Zapier is commonly used on paid plans; check [Zapier’s current pricing](https://zapier.com/pricing) before production volume.

## 1. Create the Zap trigger

1. Trigger: **Webhooks by Zapier** → **Catch Hook**.
2. Copy the **Custom Webhook URL** Zapier provides.
3. In HAIP, create a subscription (**[Webhooks & events](../webhooks.md#subscribing)**):

   `POST /api/v1/connect/subscriptions` with that URL as `callbackUrl`, your `propertyId`, `events`, and `secret`.

4. Run `POST /api/v1/connect/subscriptions/:id/test` or perform an action in HAIP that emits a subscribed event so Zapier receives a sample payload.

## 2. Signature verification

HAIP sends:

```
X-HAIP-Signature: sha256=<hex HMAC-SHA256 of raw body>
X-HAIP-Event-Id: ...
X-HAIP-Event-Type: reservation.checked_in
```

Zapier’s catch hook does not always expose raw body bytes for HMAC. Options:

- **Code by Zapier** (Python/JavaScript) on a later step if your plan includes it — recompute HMAC from the payload string and compare to the header (see **[Webhooks & events](../webhooks.md#delivery-format)**).
- **Filter** on `eventType` / `propertyId` for low-risk automations, understanding this is weaker than full HMAC verification.
- For compliance or financial workflows, prefer n8n/Make or a small verified endpoint ([webhooks-n8n.md](webhooks-n8n.md)).

## 3. Action steps

Map `eventType`, `entityId`, and `propertyId` into Slack, email, Google Sheets, etc. Fetch full guest or folio data via HAIP REST API when needed (**[lean payloads](../webhooks.md#payloads-are-intentionally-lean--fetch-the-entity-by-id)**).

## 4. Reliability

Return success quickly from Zapier’s path (Zapier handles the HTTP response to HAIP). Use Zapier’s task history plus HAIP `GET /api/v1/connect/subscriptions/:id/deliveries` to debug failures. Deduplicate on `X-HAIP-Event-Id` using Zapier Storage or a spreadsheet column.
