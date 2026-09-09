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

Missing credentials fail closed in every environment. Direct booking checks the property's credentials and currency precision before creating provisional records. For deliberate demos select `PAYMENT_GATEWAY=mock` subject to the existing production mock guard.

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

Signing keys are stored as AES-256-GCM credential blobs using HAIP's existing protected-credential key ring (`MIGRATION_CREDENTIAL_ENCRYPTION_KEY`, `MIGRATION_CREDENTIAL_ENCRYPTION_KEY_ID`, and optional `MIGRATION_CREDENTIAL_ENCRYPTION_KEYS`). Provision the existing 32-byte encryption key through deployment secrets before saving credentials; never place it in integration config. Retain old key IDs in the rotation map until their stored blobs have been rotated. Missing keys or invalid ciphertext fail closed. Only the payment credential resolver decrypts a signing key.

Input accepts `secretKey`, `secret_key`, or `clave`; all are canonicalized into `secretKeyEncrypted` at rest. Public list/get/save responses strip every spelling and the encrypted blob, returning only a fixed `secretKeyMasked` configured indicator. A blank or omitted secret preserves the existing credential; callers cannot submit ciphertext.

### Existing installations

Run the normal `pnpm db:migrate` command (including payment migrations **0024, 0025, and 0026**), build the API, then run the idempotent application data migration with the production database URL and existing credential key ring supplied securely in the environment:

```bash
node apps/api/dist/scripts/protect-redsys-credentials.js
```

Run this before enabling payment traffic; it protects existing canonical and alias values for enabled and disabled integrations. It uses tenant-scoped row locks, commits each protected config together with a redacted audit record, preserves other settings, and exits nonzero without printing credentials on failure. Rerun after correcting configuration. Existing backups may still contain historical plaintext and need the deployment's usual protected retention handling. No new schema is required because the blob uses the existing JSONB config. Do not roll back to a build that only understands plaintext signing keys.

For read compatibility, the payment resolver also performs the same scoped migration before reading a legacy credential. Public configuration reads mask legacy values even without an encryption key; they do not decrypt them. This compatibility path is not a replacement for the deployment migration, since inactive rows must also be protected.

## Flows

### Authorize (deposit / folio hold)

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

All requests use exact currency minor units from the existing ISO-4217 ledger currency table: EUR/USD/GBP/CHF have two decimals, JPY has none. Unsupported currencies and fractional minor units are rejected. Void includes the original authorized amount and currency from the persisted payment. REST success requires `HMAC_SHA512_V2`, a valid signature, matching order/merchant/terminal/amount/currency/type, and the operation's exact success code (`0900` for capture/refund, `0400` for void).

CI and release run the real PostgreSQL callback and protected-credential suites against their disposable `haip_test` service via `REDSYS_TEST_DATABASE_URL`. Local runs remain opt-in; point that variable only at a disposable migrated test database. Fixtures use random tenant IDs and remove only their own rows.

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
