# Catch HAIP webhooks in n8n

Use this when HAIP should push `entity.action` events (for example `reservation.checked_in`, `folio.settled`) into an n8n workflow.

## 1. Create a subscription in HAIP

Create a webhook subscription via the Connect API (see [Connect API key](connect-api-key.md) for `x-api-key` auth). Request body and endpoints are documented in **[Webhooks & events](../webhooks.md#subscribing)**:

- `POST /api/v1/connect/subscriptions`
- Set `callbackUrl` to your n8n webhook URL (HTTPS, publicly reachable)
- Set `events` to the patterns you need (wildcards such as `reservation.*` are supported)
- Store the `secret` you send — HAIP does not return it again

Test delivery: `POST /api/v1/connect/subscriptions/:id/test`

## 2. Add a Webhook node in n8n

1. New workflow → **Webhook** trigger → **POST**.
2. Copy the **Production URL** into HAIP `callbackUrl`.
3. Enable **Raw Body** (or equivalent) so you can verify the signature on the exact bytes HAIP signed.

## 3. Verify `X-HAIP-Signature`

HAIP signs the raw JSON body with HMAC-SHA256:

```
X-HAIP-Signature: sha256=<hex>
X-HAIP-Event-Id: <uuid>
X-HAIP-Event-Type: reservation.checked_in
```

Compare using constant-time equality. Example logic is in **[Webhooks & events](../webhooks.md#delivery-format)**. In n8n, a **Code** node can run the same check before downstream steps.

Reject requests that fail verification (respond with 401).

## 4. Handle the payload

Body shape:

```json
{
  "eventType": "reservation.checked_in",
  "propertyId": "...",
  "entityType": "reservation",
  "entityId": "...",
  "data": { },
  "timestamp": "2026-07-17T14:03:22.118Z"
}
```

Payloads are lean — fetch full records from the REST API using `entityId` and `propertyId` when you need guest or folio detail (see **[Webhooks & events](../webhooks.md#payloads-are-intentionally-lean--fetch-the-entity-by-id)**).

## 5. Respond quickly

Return any **2xx** within **5 seconds**. Use a **Respond to Webhook** node (or let the Webhook node auto-respond) before slow work, or queue follow-up nodes asynchronously.

Deduplicate on `X-HAIP-Event-Id`; deliveries are at-least-once. For missed events, poll `GET /api/v1/connect/events` as described in **[Webhooks & events](../webhooks.md#reconciliation--polling-fallback)**.
