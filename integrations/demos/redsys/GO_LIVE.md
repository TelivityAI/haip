# Go live — Redsys

1. Run the demo once (enables the Integrations catalog toggle):

```bash
./integrations/demos/run.sh redsys
```

2. Set process env and restart the API:

```bash
PAYMENT_GATEWAY=redsys
REDSYS_MERCHANT_CODE=<FUC from your Spanish bank>
REDSYS_TERMINAL=001
REDSYS_SECRET_KEY=<signing key from Redsys admin>
REDSYS_ENV=test   # or live
PUBLIC_API_BASE_URL=https://<public-api-host>
```

3. In Dashboard → Integrations → Redsys, enter the same FUC / terminal / secret / environment for the property (per-hotel credentials override env).

4. Confirm the terminal allows **preauthorizations** (type 1). Without that, Redsys returns SIS0256 / similar.

5. Take a test deposit from the booking widget and a folio authorize from the dashboard. Confirm:
   - Browser redirects to Redsys `realizarPago`
   - MerchantURL notification hits `POST /api/v1/webhooks/redsys`
   - Payment row moves `pending` → `authorized`
   - Capture / void / refund work from the folio

Docs: [docs/integrations/payments-redsys.md](../../docs/integrations/payments-redsys.md)
