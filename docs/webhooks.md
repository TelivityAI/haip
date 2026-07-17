# Webhooks & Events

HAIP emits an event for every significant state change, following the
`entity.action` naming convention (`reservation.checked_in`, `folio.settled`,
`invoice.issued`, ...). External services — channel partners, OTAIP agents, and
**regional compliance integrations** (government guest registration, tax
invoicing, ...) — consume these events by subscribing to webhooks or by
polling.

The authoritative event catalog is `WEBHOOK_EVENTS` in
[`packages/shared/src/index.ts`](../packages/shared/src/index.ts).

## Subscribing

```
POST   /api/v1/connect/subscriptions               # Subscribe to events
GET    /api/v1/connect/subscriptions?propertyId=…  # List subscriptions
DELETE /api/v1/connect/subscriptions/:id           # Unsubscribe
POST   /api/v1/connect/subscriptions/:id/test      # Send a test event
GET    /api/v1/connect/subscriptions/:id/deliveries # Inspect delivery attempts
GET    /api/v1/connect/events                      # Poll for events (fallback)
```

Create a subscription with the events you want (wildcards supported):

```json
POST /api/v1/connect/subscriptions
{
  "propertyId": "0d0af5aa-…",
  "subscriberId": "br-compliance-service",
  "subscriberName": "Brazil Compliance Service",
  "callbackUrl": "https://compliance.example.com/haip-events",
  "events": ["reservation.checked_in", "reservation.checked_out", "invoice.*"],
  "secret": "a-long-random-hmac-secret-you-keep"
}
```

Notes:

- `callbackUrl` must be HTTPS and publicly resolvable (private/internal
  addresses are rejected — SSRF protection).
- The `secret` is write-only: it is never returned by the API, so keep your
  own copy. It is used to sign every delivery (see below).
- Event patterns support `entity.*` (all actions of one entity) and `*` / `**`
  (everything).

## Delivery format

Each matching event is POSTed to your `callbackUrl`:

```
POST <callbackUrl>
Content-Type: application/json
X-HAIP-Signature: sha256=<hex HMAC-SHA256 of the raw body, keyed by your secret>
X-HAIP-Event-Id: <delivery uuid>
X-HAIP-Event-Type: reservation.checked_in
```

```json
{
  "eventType": "reservation.checked_in",
  "propertyId": "0d0af5aa-…",
  "entityType": "reservation",
  "entityId": "9a1b2c3d-…",
  "data": { "roomId": "…", "folioId": "…", "isEarlyCheckin": false },
  "timestamp": "2026-07-17T14:03:22.118Z"
}
```

Verify the signature before trusting a delivery:

```ts
import { createHmac, timingSafeEqual } from 'crypto';

function verify(rawBody: string, header: string, secret: string): boolean {
  const expected = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
  return (
    header.length === expected.length &&
    timingSafeEqual(Buffer.from(header), Buffer.from(expected))
  );
}
```

Respond with any 2xx status within 5 seconds. Anything else (including a
timeout) counts as a failed attempt.

### Payloads are intentionally lean — fetch the entity by id

Event payloads carry identifiers and a few action-specific fields, **not** the
full entity. This keeps PII (guest identity documents, addresses) out of
webhook bodies, delivery logs, and your queue. On receipt, fetch what you need
from the REST API using `entityId`:

- `reservation.checked_in` → `GET /api/v1/reservations/:entityId?propertyId=…`
  → the reservation includes `guestId` → `GET /api/v1/guests/:guestId?propertyId=…`
  for the guest profile (name, ID document, nationality, date of birth,
  address — the fields typically needed for government guest registration).
- `folio.settled` → `GET /api/v1/folios/:entityId?propertyId=…` and
  `GET /api/v1/folios/:entityId/charges?propertyId=…` for line items.

Your subscriber authenticates to the REST API with its own OAuth credentials;
the webhook alone grants no data access.

### Retries

Failed deliveries are retried with exponential backoff: 30s, 2m, 10m, 1h, 6h
(5 attempts total, ~7h). Deliveries can arrive **more than once** (at-least-
once semantics) and out of order — deduplicate on `X-HAIP-Event-Id` and treat
handlers as idempotent.

After the final attempt the delivery is marked `failed` and a **critical staff
notification** (`webhook_delivery_failed`) is created for the property, so
operators notice when a mandatory integration (e.g. government reporting)
stops receiving events. Failed deliveries remain inspectable via
`GET /api/v1/connect/subscriptions/:id/deliveries`.

### Reconciliation / polling fallback

If your service was down past the retry window (or can't receive webhooks at
all), poll:

```
GET /api/v1/connect/events?propertyId=…&since=2026-07-17T00:00:00Z&types=reservation.*
```

Running a periodic reconciliation sweep against this endpoint is the
recommended safety net for compliance-critical integrations.

## Fiscal documents (`invoice.*`)

For jurisdictions that require official tax documents (e.g. NFS-e tax notes in
Brazil), HAIP stores a **fiscal document reference** on the folio and emits
`invoice.*` events. Core contains no regional tax logic — issuance is
performed by an external integration:

1. Staff (or an automation) requests a document:
   `POST /api/v1/folios/:folioId/fiscal-documents`
   `{ "propertyId": "…", "documentType": "nfse", "metadata": { … } }`
   → HAIP emits **`invoice.requested`** (entity: `fiscal_document`).
2. Your integration receives the event, fetches the folio and charges, and
   issues the document against the government/tax-authority API.
3. It reports the result back:
   `POST /api/v1/folios/:folioId/fiscal-documents/:documentId/issue`
   `{ "propertyId": "…", "documentNumber": "2026-000123", "documentUrl": "…" }`
   → HAIP emits **`invoice.issued`** and the official document number is now
   linked to the folio in the PMS.
4. Voiding/cancelling (either a pending request or an issued document):
   `POST /api/v1/folios/:folioId/fiscal-documents/:documentId/void`
   → HAIP emits **`invoice.voided`**.

`documentType` is a free-form regional identifier and `metadata` is a
pass-through JSON object for regional fields (series, verification codes,
municipal registrations, ...) — core never interprets either.

List documents for a folio:
`GET /api/v1/folios/:folioId/fiscal-documents?propertyId=…`

## Example: government guest registration

A minimal compliance integration for jurisdictions that require reporting
guest data on arrival/departure:

1. Subscribe to `reservation.checked_in` and `reservation.checked_out`.
2. On each event, fetch the reservation, then the guest profile.
3. Submit to the government API from your service.
4. Deduplicate on `X-HAIP-Event-Id`; run a nightly reconciliation sweep via
   `GET /api/v1/connect/events` to catch anything missed.
5. Watch for `webhook_delivery_failed` staff notifications (or monitor
   `/subscriptions/:id/deliveries`) so a broken endpoint is noticed quickly.

## WebSocket mirror

All webhook events are also broadcast over Socket.IO to dashboard clients
subscribed to the property — see the README's *WebSocket — Real-time Events*
section. WebSockets are for live UIs; use webhook subscriptions (with retries
and signatures) for integrations.
