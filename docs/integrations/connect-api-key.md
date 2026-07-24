# Connect API with `x-api-key`

The Connect surface (`/api/v1/connect/*`) and related machine endpoints (for example folio inbound) authenticate with an API key header, not end-user JWTs.

## Header

```http
x-api-key: <your-secret-key>
```

The guard also accepts `X-API-Key`. Keys are compared using a hashed lookup; treat them like passwords.

## Key types

| Scope | How it is issued | Tenant behavior |
|-------|------------------|-----------------|
| **Property** | Row in `connect_credentials` (SHA-256 hash stored server-side; raw key shown once at creation) | Locked to one `propertyId` |
| **Platform** | Server env `CONNECT_API_KEY` (trusted server-side callers) | May act across tenants where the API allows |

Property-scoped keys are required for integrations that must not cross tenants (POS, folio inbound, property-bound webhook subscriptions).

Interactive reference for all operations: **`https://<your-host>/docs`** — look for tag **Connect — OTAIP Agent API** and security scheme **api-key**.

## Common Connect paths

```
POST   /api/v1/connect/search
GET    /api/v1/connect/properties
GET    /api/v1/connect/properties/:id
POST   /api/v1/connect/book
GET    /api/v1/connect/bookings/:confirmationNumber/verify
PATCH  /api/v1/connect/bookings/:confirmationNumber
DELETE /api/v1/connect/bookings/:confirmationNumber
GET    /api/v1/connect/insights/revenue
GET    /api/v1/connect/insights/guest-triggers
```

Booking flows use confirmation numbers; scope rules are enforced by `ConnectScopeGuard` on property keys.

## Webhook subscriptions (same key)

Event delivery is configured through Connect subscriptions — full detail in **[Webhooks & events](../webhooks.md#subscribing)**:

```
POST   /api/v1/connect/subscriptions
GET    /api/v1/connect/subscriptions?propertyId=<uuid>
DELETE /api/v1/connect/subscriptions/:id
POST   /api/v1/connect/subscriptions/:id/test
GET    /api/v1/connect/subscriptions/:id/deliveries
GET    /api/v1/connect/events?propertyId=<uuid>&since=...&types=...
```

Example subscription body:

```json
{
  "propertyId": "0d0af5aa-0000-4000-8000-000000000001",
  "subscriberId": "my-automation",
  "subscriberName": "My Automation",
  "callbackUrl": "https://hooks.example.com/haip",
  "events": ["reservation.*", "folio.settled"],
  "secret": "long-random-hmac-secret"
}
```

## Example request

```bash
curl -sS -X POST "https://your-haip.example.com/api/v1/connect/subscriptions" \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_KEY" \
  -d '{"propertyId":"...","subscriberId":"n8n","callbackUrl":"https://...","events":["*"],"secret":"..."}'
```

## Related endpoints using the same key

- `POST /api/v1/folio-inbound/charges` — [Folio inbound (POS)](folio-inbound-pos.md)
- `POST /api/v1/pos/charges` — outlet POS variant (see OpenAPI **pos** tag)

Staff-facing REST routes (folios, reservations, reports) use OAuth/Keycloak — use Connect + webhooks for integrations, or service accounts as your deployment documents.
