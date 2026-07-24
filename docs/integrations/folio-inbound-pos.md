# Folio inbound charges (any POS)

Post incidental charges from a POS, minibar system, spa terminal, or custom middleware onto the **in-house guest folio** without staff manual entry.

## Endpoint

```http
POST /api/v1/folio-inbound/charges
Content-Type: application/json
x-api-key: <property-scoped Connect API key>
```

Authentication matches the Connect API: **`ApiKeyGuard`** + **`ConnectScopeGuard`**. A property-scoped key automatically pins the tenant; platform keys are not usable here without a bound property (the controller requires `principal.propertyId`).

OpenAPI tag: **folio-inbound**.

## Request body

| Field | Required | Notes |
|-------|----------|--------|
| `roomNumber` | yes | Guest room number (max 20 chars) |
| `type` | yes | One of: `food_beverage`, `minibar`, `phone`, `laundry`, `parking`, `spa`, `incidental`, `fee`, `adjustment`, `package` |
| `amount` | yes | Decimal string, e.g. `"18.50"` |
| `currencyCode` | yes | ISO 4217, e.g. `"USD"` |
| `vendorTxnId` | yes | Your unique transaction id (max 120) — used for idempotency |
| `description` | no | Line description |
| `serviceDate` | no | `YYYY-MM-DD` |

Example:

```json
{
  "roomNumber": "1204",
  "type": "minibar",
  "amount": "18.50",
  "currencyCode": "USD",
  "vendorTxnId": "pos-txn-0001249",
  "description": "Minibar restock",
  "serviceDate": "2026-07-23"
}
```

## Behavior

- Resolves the room and an **in-house** reservation (`checked_in`, `stayover`, or `due_out`) for that property.
- Posts the charge to the guest folio via the core folio service.
- **Duplicate `vendorTxnId`** for the same property returns the existing charge (safe retries from POS).
- Unknown room → `400`; no in-house guest → error from business rules.

## POS integration pattern

1. Issue a **property-scoped** API key ([Connect API key](connect-api-key.md)).
2. On checkout at the POS, send room number (from room charge account or PMS lookup) and line items.
3. Retry on network errors with the **same** `vendorTxnId`.
4. Optionally subscribe to `folio.*` or payment events via **[webhooks](../webhooks.md)** for reconciliation.

## Alternative: `/api/v1/pos/charges`

HAIP also exposes **`POST /api/v1/pos/charges`** for outlet POS integrations (DTO includes explicit `propertyId` for platform callers). Prefer **folio-inbound** when you only have room number + amount and a property-bound key.

## Catalog rows (Wave 3 recipes)

POS vendors that post via this inbound pattern (middleware maps vendor tickets → folio charges):

`square-pos`, `toast`, `clover`, `epos-now`, `shopify-pos`, `loyverse`, `erply`, `marketman`.

