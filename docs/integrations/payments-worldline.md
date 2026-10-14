# Worldline Online Payments

HAIP card flows (`POST /api/v1/payments/authorize`, capture, void, refund) use a pluggable **PaymentGateway**. Set `PAYMENT_GATEWAY=worldline` to take a card hold on the HAIP page. The card field is an iframe from Worldline. HAIP receives a hosted tokenization id, then creates a `PRE_AUTHORIZATION`. Card numbers are not sent to HAIP.

A bank challenge can still send the guest to the issuer. That return is not proof of payment. HAIP reads the payment with GetPayment and stores the payment id. The older full-page checkout remains available for a `worldline_hosted` token already in flight.

Capture, cancel, and refund run later through the official Node server SDK.

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

The booking page and the folio authorize screen load `https://<host>/hostedtokenization/js/client/tokenizer.min.js` and frame the hosted tokenization URL. A page that sets a Content-Security-Policy must allow that host on `script-src`, `frame-src`, and `connect-src`.

Missing merchant id, API key id, or secret fails the operation. It does not pretend the payment succeeded.

A property can store the same fields on Integrations → Worldline (`merchantId`, `apiKeyId`, `secretApiKey`, `environment`, `webhookKeyId`, `webhookSecret`). Secrets are encrypted at rest. An invalid ciphertext does not fall back to the process environment.

## Guest checkout

`paymentMethodClientMode` is `worldline`.

The booking widget calls `POST /api/v1/booking-engine/worldline-tokenization` and mounts the card field on the payment page. Submit returns a hosted tokenization id. That id is `paymentToken` on book. The folio screen does the same with `POST /api/v1/payments/worldline/tokenization` (`folios.manage`) and sends the id to `POST /api/v1/payments/authorize`.

Authorize calls `payments.createPayment` with `hostedTokenizationId`, `authorizationMode: PRE_AUTHORIZATION`, and the return URL. A frictionless hold completes on the page. `merchantAction.actionType` `REDIRECT` is a GET to the bank. The payment row stays pending with the payment id until GetPayment says the hold is authorized.

The browser return is not proof of payment. The booking return status and `POST /api/v1/payments/worldline/sync` call GetPayment first. A hosted-checkout id that is not a payment falls through to GetHostedCheckout. Folio staff return to `?worldline=return` after a bank challenge. Do not treat that query flag as success.

A token of `worldline_hosted` still creates a hosted checkout and a GET redirect. New booking and folio screens do not send that token.

## Webhook

`GET /api/v1/webhooks/worldline` echoes `X-GCS-Webhooks-Endpoint-Verification`.

`POST /api/v1/webhooks/worldline` checks `X-GCS-Signature` (HMAC-SHA256 of the raw body, base64) against the secret for `X-GCS-KeyId` before it changes a payment. A signed `payment.pending_capture` with status code 5 and a payment id promotes a pending row. A signed rejection or customer cancel marks it failed. Duplicate events are ignored once the row is no longer pending. Webhooks are the fallback; the return-status read completes checkout.

## Maintenance

| HAIP | Server call |
|------|-------------|
| card field | `hostedTokenization.createHostedTokenization` |
| authorize (in-page) | `payments.createPayment` with `hostedTokenizationId` |
| authorize (`worldline_hosted`) | `hostedCheckout.createHostedCheckout` |
| return / sync | `payments.getPayment`, then `hostedCheckout.getHostedCheckout` |
| capture | `payments.capturePayment` (`isFinal` when the amount is the full hold) |
| void | `payments.cancelPayment` |
| refund | `payments.refundPayment` |

Amounts are minor units (cents for two-decimal currencies), same as the other HTTP gateways.

Saved cards are not supported on this gateway.
