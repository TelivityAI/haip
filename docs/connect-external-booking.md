# Connect API — external booking platforms

HAIP’s Connect module lets external platforms (AI assistants, aggregators, partner apps) search and book inventory with a **scoped API key**. This document covers the booking surface only. Pricing and commercial terms for any particular distribution product are out of scope here.

## Auth

Send the platform key on every request:

```http
x-api-key: <CONNECT_API_KEY>
```

Keys are validated by `ApiKeyGuard` and scoped by `ConnectScopeGuard`. Do not embed property admin JWTs in client platforms.

Base path: `/api/v1/connect`.

## Book

```http
POST /api/v1/connect/book
Content-Type: application/json
x-api-key: <CONNECT_API_KEY>
```

Body (selected fields):

| Field | Notes |
|-------|--------|
| `propertyId`, `roomTypeId`, `ratePlanId` | UUIDs |
| `checkIn`, `checkOut` | ISO dates |
| `guestFirstName`, `guestLastName` | Required |
| `guestEmail` | Required for `hosted_checkout` |
| `adults`, `children` | Occupancy |
| `paymentMethod` | `pay_at_property` \| `hosted_checkout` (preferred for assistants); `prepaid` / `virtual_card` accepted for compatibility |
| `idempotencyKey` | Required for `hosted_checkout` |
| `clientPlatform` | Optional free-text attribution tag |
| `agentId` | Optional channel code written to the booking when provided |
| `externalReference` | Optional partner reference |

Hosted checkout returns a payment session / redirect URL; complete payment via the payment-status / confirm-payment (or PSP webhook) flow before the stay is fully confirmed.

## Verify

```http
GET /api/v1/connect/bookings/:confirmationNumber/verify
x-api-key: <CONNECT_API_KEY>
```

Returns booking status and guest-safe details for the confirmation number. Possession of the confirmation number plus a valid API key is the access model.

## Cancel

```http
DELETE /api/v1/connect/bookings/:confirmationNumber
Content-Type: application/json
x-api-key: <CONNECT_API_KEY>
```

Optional JSON body may include a `reason`. Penalties follow the property’s cancellation policy.

## Related

- Modify: `PATCH /api/v1/connect/bookings/:confirmationNumber`
- Hosted payment helpers: `…/payment-status`, `…/confirm-payment`, `…/mock-pay` (non-production), `…/payment-return`
- OpenAPI: served by the Nest API Swagger UI at `/docs`
