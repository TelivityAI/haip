# Redsys payment adapter

HAIP card flows (`POST /api/v1/payments/authorize`, capture, void, refund) use a pluggable **PaymentGateway**. This recipe covers **Redsys** (Spanish bank TPV Virtual) for direct-booking deposits and front-desk folio pre-auth.

Stripe remains the default when `PAYMENT_GATEWAY` is unset and `STRIPE_MODE` is `test` or `live`. See also [Adyen / Mollie / Square / Braintree](./payments-adyen-mollie-square-braintree.md).

## Selection

| Variable | Values | Notes |
|----------|--------|-------|
| `PAYMENT_GATEWAY` | `redsys` | Selects the Redsys adapter |
| `REDSYS_MERCHANT_CODE` | FUC (9 digits) | Env fallback when property Integrations config is empty |
| `REDSYS_TERMINAL` | e.g. `001` | Terminal number |
| `REDSYS_SECRET_KEY` | signing key | From Redsys admin “Consulta datos del Comercio” |
| `REDSYS_ENV` | `test` (default) \| `live` | Chooses `sis-t` vs `sis` endpoints |
| `PUBLIC_API_BASE_URL` | `https://…` | Used to build MerchantURL `…/api/v1/webhooks/redsys` |

When credentials are missing, the adapter runs in **console mode** (logged mock success, no HTTP) — same pattern as Mollie/Adyen.

## Per-property credentials

Each Spanish hotel typically has its own FUC. Store credentials on the property Integrations row for slug `redsys`:

```json
{
  "merchantCode": "999008881",
  "terminal": "001",
  "secretKey": "…",
  "environment": "test"
}
```

Dashboard → Integrations → Redsys exposes this form. Property config overrides process env at authorize/capture/void/refund time.

## Flows

### Authorize (deposit / folio hold)

> **Lifecycle (hosted redirect):** browser URLOK/URLKO is navigation only.
> The signed MerchantURL notification is the authority. HAIP records the
> deposit ledger entry and runs booking-engine auto-confirm only after that
> verified success (idempotent finalizer). Return URLs carry an opaque
> `haip_checkout` token so the MemoryRouter booking widget can restore state.


1. Client calls `POST /api/v1/payments/authorize` with `gatewayProvider: "redsys"`, `gatewayPaymentToken: "redsys_redirect"`, and `redirectUrlOk` / `redirectUrlKo`.
2. HAIP creates a **pending** payment, signs `Ds_MerchantParameters` (HMAC_SHA512_V2), and returns `nextAction` (POST form fields + Redsys `realizarPago` URL).
3. Client auto-submits the form; guest completes 3DS on Redsys.
4. Redsys POSTs the signed notification to MerchantURL. HAIP verifies the signature and moves the payment to **authorized**.
5. Browser returns to URLOK / URLKO — those URLs alone are **not** trusted for fulfillment.

Transaction type: **1** (preauthorization). The terminal must allow preauth.

### Capture / void / refund

Server-side REST `trataPeticionREST`:

| Operation | `Ds_Merchant_TransactionType` |
|-----------|-------------------------------|
| Capture | `2` |
| Void uncaptured hold | `9` |
| Refund | `3` |

`transactionId` stored on the payment row is the Redsys `Ds_Order` (4–12 chars).

## Client mode

`paymentMethodClientMode` becomes `redsys` when `PAYMENT_GATEWAY=redsys`. The booking widget and folio authorize UI use hosted redirect instead of Stripe Elements.

`GET /api/v1/payments/client-config?propertyId=` returns `{ provider, clientMode, redsysConfigured }`.

## Sandbox

Official test credentials (see Redsys developer docs):

- FUC `999008881`, terminal `001`, secret `sq7HjrUOBfKmC576ILgskD5srU870gJ7`
- Redirect: `https://sis-t.redsys.es:25443/sis/realizarPago`
- Test Visa: `4548810000000003` / exp `12/34` / CVV `123` (CIP `123456` when challenged)

## Demo

```bash
./integrations/demos/run.sh redsys
```

## Webhooks

| Provider | Endpoint |
|----------|----------|
| Stripe | `POST /api/v1/webhooks/stripe` (raw JSON) |
| Redsys | `POST /api/v1/webhooks/redsys` (form-urlencoded, HMAC verified) |

## Saved cards

Redsys uses `UnsupportedSavedPaymentMethodGateway` (same as Adyen/Mollie). Request-flow card vaulting is not part of this adapter.
