# Adyen, Mollie, Square, and Braintree payment adapters

HAIP card flows (`POST /api/v1/payments/authorize`, capture, void, refund) use a pluggable **PaymentGateway** adapter. Stripe remains the default when `PAYMENT_GATEWAY` is unset and `STRIPE_MODE` is `test` or `live`. This recipe covers the Wave 2 PSP adapters: **Adyen**, **Mollie**, **Square**, and **Braintree**.

See also the [Payments section](../INTEGRATIONS.md#payments) in the integration catalog.

## Select a gateway

Set on the API container (see [`.env.example`](../../.env.example)):

| Variable | Values | Notes |
|----------|--------|--------|
| `PAYMENT_GATEWAY` | `mock`, `stripe`, `adyen`, `mollie`, `square`, `braintree` | Primary selector |
| `STRIPE_MODE` | `mock` (default), `test`, `live` | Legacy: when `PAYMENT_GATEWAY` is unset, `mock` → MockGateway, else Stripe |

**Examples**

```bash
# Local / CI — no PSP credentials
PAYMENT_GATEWAY=mock

# Adyen in test (HTTP when keys set; console mock when keys missing)
PAYMENT_GATEWAY=adyen
ADYEN_API_KEY=...
ADYEN_MERCHANT_ACCOUNT=YourMerchant
ADYEN_ENV=test
```

When credentials for a non-Stripe PSP are missing, the adapter logs a `[console]` message and returns success with synthetic transaction ids (same behavior as `MockGateway`). Set the env vars below to enable real HTTP calls.

Production boot checks treat `PAYMENT_GATEWAY=mock` (or unset + `STRIPE_MODE=mock`) as insecure. Using e.g. `PAYMENT_GATEWAY=adyen` satisfies the payment check even if `STRIPE_MODE=mock`.

## Record the provider on each payment

On authorize, set `gatewayProvider` in the request body to match the adapter (`adyen`, `mollie`, `square`, `braintree`, or `stripe`). HAIP stores this on the payment row for reconciliation and webhooks.

## Adyen

| Env | Purpose |
|-----|---------|
| `ADYEN_API_KEY` | Checkout API key (`X-API-Key`) |
| `ADYEN_MERCHANT_ACCOUNT` | Merchant account code |
| `ADYEN_ENV` | `test` (default) or `live` |
| `ADYEN_CHECKOUT_URL` | Optional API base override |

**Token:** stored payment method id from Adyen Drop-in / Components.  
**Transaction id:** Adyen `pspReference` from authorize.

Operations map to Checkout `/payments`, `/captures`, `/cancels`, and `/refunds`.

## Mollie

| Env | Purpose |
|-----|---------|
| `MOLLIE_API_KEY` | Bearer API key |
| `MOLLIE_API_BASE` | Default `https://api.mollie.com/v2` |

**Token:** card token from Mollie Components.  
**Transaction id:** payment id (`tr_…`).

Uses Mollie Payments with `captureMode: manual`, then `/captures`, `/cancel`, and `/refunds`.

## Square

| Env | Purpose |
|-----|---------|
| `SQUARE_ACCESS_TOKEN` | OAuth / personal access token |
| `SQUARE_LOCATION_ID` | Location for `CreatePayment` |
| `SQUARE_ENV` | `sandbox` (default) or `production` |
| `SQUARE_API_BASE` | Optional override |

**Token:** payment nonce from Square Web Payments SDK (`source_id`).  
**Transaction id:** Square payment id.

Authorize uses `autocomplete: false`; capture calls `/payments/{id}/complete`.

## Braintree

| Env | Purpose |
|-----|---------|
| `BRAINTREE_MERCHANT_ID` | Merchant id |
| `BRAINTREE_PUBLIC_KEY` | API public key |
| `BRAINTREE_PRIVATE_KEY` | API private key |
| `BRAINTREE_ENV` | `sandbox` (default) or `production` |
| `BRAINTREE_API_BASE` | Optional override |

**Token:** payment method nonce or vaulted token from the Braintree client SDK.  
**Transaction id:** Braintree transaction id.

Authorize creates a sale with `submitForSettlement: false`; capture uses `submit_for_settlement`.

## API flow (all PSPs)

Same REST surface as Stripe today:

1. `POST /api/v1/payments/authorize?propertyId={uuid}` — body includes `gatewayPaymentToken`, `gatewayProvider`, amount, folio.
2. `POST /api/v1/payments/{id}/capture?propertyId={uuid}`
3. `POST /api/v1/payments/{id}/void?propertyId={uuid}`
4. `POST /api/v1/payments/{id}/refund?propertyId={uuid}`

Idempotency keys are forwarded to gateways that support them (Adyen, Mollie, Square) on capture, void, and refund.

## Webhooks

Stripe webhooks remain on `/api/v1/payments/stripe/webhook`. Adyen/Mollie/Square/Braintree webhook receivers are not part of this adapter slice; reconcile via PSP dashboards or a follow-up integration wave.
