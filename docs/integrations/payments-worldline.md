# Worldline Online Payments

HAIP card flows (`POST /api/v1/payments/authorize`, capture, void, refund) use a pluggable **PaymentGateway**. Set `PAYMENT_GATEWAY=worldline` to take guest payments on Worldline Direct hosted checkout. Card numbers stay on that page. HAIP stores the hosted checkout id, then the payment id after the guest returns.

Authorize is a hold (`PRE_AUTHORIZATION` for cards, `requiresApproval` for redirect methods). Capture, cancel, and refund run later through the official Node server SDK.

## Select the gateway

| Variable | Purpose |
|----------|---------|
| `PAYMENT_GATEWAY` | `worldline` |
| `WORLDLINE_MERCHANT_ID` | PSPID. Used when the property has no Integrations row |
| `WORLDLINE_API_KEY_ID` | API key id |
| `WORLDLINE_SECRET_API_KEY` | API secret |
| `WORLDLINE_ENV` | `test` (default) or `live` |
| `WORLDLINE_WEBHOOK_KEY_ID` | Webhook key id for signature checks |
| `WORLDLINE_WEBHOOK_SECRET` | Webhook secret |
| `PUBLIC_API_BASE_URL` | Public API origin for the booking return relay |
| `BOOKING_RETURN_ORIGINS` | Allowed hotel page origins |

Test host: `payment.preprod.direct.worldline-solutions.com`. Live host: `payment.direct.worldline-solutions.com`.

Missing merchant id, API key id, or secret fails the operation. It does not pretend the payment succeeded.

A property can store the same fields on Integrations → Worldline (`merchantId`, `apiKeyId`, `secretApiKey`, `environment`, `webhookKeyId`, `webhookSecret`). Secrets are encrypted at rest. An invalid ciphertext does not fall back to the process environment.

## Guest checkout

`paymentMethodClientMode` is `worldline`. The booking widget sends `paymentToken: worldline_hosted` and follows the GET `nextAction`. The folio authorize screen does the same.

The browser return is not proof of payment. The booking return status calls GetHostedCheckout and, when the payment is pending capture (status code 5), stores the payment id and marks the row authorized. Folio staff return to `?worldline=return`, which asks `POST /api/v1/payments/worldline/sync` to do the same read. Do not treat that query flag as success.

## Webhook

`GET /api/v1/webhooks/worldline` echoes `X-GCS-Webhooks-Endpoint-Verification`.

`POST /api/v1/webhooks/worldline` checks `X-GCS-Signature` (HMAC-SHA256 of the raw body, base64) against the secret for `X-GCS-KeyId` before it changes a payment. A signed `payment.pending_capture` with status code 5 promotes a pending row. A signed rejection or customer cancel marks it failed. Duplicate events are ignored once the row is no longer pending. Webhooks are the fallback; the return-status read completes checkout.

## Maintenance

| HAIP | Server call |
|------|-------------|
| authorize | `hostedCheckout.createHostedCheckout` |
| capture | `payments.capturePayment` (`isFinal` when the amount is the full hold) |
| void | `payments.cancelPayment` |
| refund | `payments.refundPayment` |

Amounts are minor units (cents for two-decimal currencies), same as the other HTTP gateways.

Saved cards are not supported on this gateway.
