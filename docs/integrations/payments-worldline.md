# Worldline Online Payments

HAIP card flows (`POST /api/v1/payments/authorize`, capture, void, refund) use a pluggable **PaymentGateway**. Set `PAYMENT_GATEWAY=worldline` to take a card hold on the HAIP page. The card field is an iframe from Worldline. HAIP receives a hosted tokenization id, then creates a `PRE_AUTHORIZATION`. Card numbers are not sent to HAIP.

A bank challenge can still send the guest to the issuer. That return is not proof of payment. HAIP calls GetPaymentDetails with the payment id and stores one result: authorized, failed, or still pending. The older full-page checkout remains available for a `worldline_hosted` token already in flight.

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

Authorize calls `payments.createPayment` with `hostedTokenizationId`, `authorizationMode: PRE_AUTHORIZATION`, and the return URL. A frictionless hold completes on the page. Status code 9 or status `CAPTURED` is stored as `captured` and the folio balance is recalculated. Status code 5, `PENDING_CAPTURE`, or `isAuthorized` is stored as a hold. `merchantAction.actionType` `REDIRECT` is a GET to the bank. That payment row stays pending with the payment id, and a job is queued for 30 minutes later.

The browser return is not proof of payment. The booking return status and `POST /api/v1/payments/worldline/sync` call `payments.getPaymentDetails` first. Status code 9 or `CAPTURED` finishes as a capture. Status code 5, `PENDING_CAPTURE`, or `isAuthorized` authorizes the row. Status code 2 is a decline even when the status text is absent, as are status code 1, `REJECTED`, `CANCELLED`, and category `REJECTED`. A successful body that is none of those stays pending. A thrown read, a non-success provider response, or missing credentials is unavailable: the payment stays pending, and the guest keeps seeing that it is still being checked. A hosted-checkout id that is not a payment falls through to GetHostedCheckout.

A booking return reports payment status and, once the payment is succeeded or failed, the reservation status. It never includes a confirmation number. A decline cancels a reservation that is still `pending`, with reason "Payment was not authorized", and does not apply a cancellation penalty. The cancellation event includes arrival date, departure date, and room type so availability is released. A reservation that is already confirmed or in-house is left as it is. A non-final authorization (for example `AUTHORIZATION_REQUESTED`) stays pending. A provider error on the status read is unavailable, not pending.

Folio staff return to `?worldline=return` after a bank challenge. The toast follows the sync status. A pending Worldline payment on the open folio is polled every 3 seconds until it is authorized, failed, or captured, the page unmounts, or 30 minutes have passed since that payment was created. A refresh keeps checking. Do not treat the query flag as success.

If the guest closes the bank page, the queued job calls the same sync. An authorized or declined result is stored. If the bank is still pending and a payment id exists, the job cancels that payment at the provider before it fails the row with "Bank challenge was not completed" and cancels the unpaid pending reservation. If that cancel fails, or the read is unavailable, the job retries with backoff and does not cancel the reservation. A signed capture also recalculates the folio balance. A guest who already finished leaves no pending row, so the job does nothing. The deadline worker starts only when `PAYMENT_GATEWAY` is `worldline`.

A token of `worldline_hosted` still creates a hosted checkout and a GET redirect. New booking and folio screens do not send that token.

## Webhook

`GET /api/v1/webhooks/worldline` echoes `X-GCS-Webhooks-Endpoint-Verification`.

`POST /api/v1/webhooks/worldline` checks `X-GCS-Signature` (HMAC-SHA256 of the raw body, base64) against the secret for `X-GCS-KeyId` before it changes a payment. The key id belongs to one property. The event merchant id must be present and equal that property's merchant, and the payment lookup is limited to that property. A signed `payment.pending_capture` with status code 5 and a payment id promotes a pending row to authorized. A signed `payment.captured` whose result is a capture (status code 9 or `CAPTURED`) with a payment id stores `captured` and recalculates that folio's balance. A signed `payment.rejected`, or a `payment.cancelled` that classifies as failed (including status code 2 with no status text), marks the row failed and cancels an unpaid pending reservation. Duplicate events are ignored once the row is no longer pending. Webhooks are the fallback; the return-status read completes checkout.

## Maintenance

| HAIP | Server call |
|------|-------------|
| card field | `hostedTokenization.createHostedTokenization` |
| authorize (in-page) | `payments.createPayment` with `hostedTokenizationId` |
| authorize (`worldline_hosted`) | `hostedCheckout.createHostedCheckout` |
| return / sync | `payments.getPaymentDetails`, then `hostedCheckout.getHostedCheckout` |
| capture | `payments.capturePayment` (`isFinal` when the amount is the full hold) |
| void | `payments.cancelPayment` |
| refund | `payments.refundPayment` |

Amounts are minor units (cents for two-decimal currencies), same as the other HTTP gateways.

Saved cards are not supported on this gateway.
