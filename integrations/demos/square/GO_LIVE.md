# Go live — Square

## 60-second mock (already done by demo)
```bash
./integrations/demos/run.sh square
```
Toggle ON. Without keys the gateway uses mock/console (no real charges).

## Live in a jiffy
1. Copy [`demo.env.example`](./demo.env.example) values into `.env` (uncomment the live block).
2. Set process selector and restart API:
   ```bash
   # in .env
   PAYMENT_GATEWAY=square
   # plus live keys from demo.env.example
   docker compose up -d --force-recreate api
   ```
3. Re-run `./integrations/demos/run.sh square` (keeps toggle ON).
4. Take a **test payment** from the folio / booking flow; confirm a real PSP id in the payment ledger.
5. Configure webhooks (Stripe/Adyen/…) to your HAIP public URL when the PSP requires them.

Docs: docs/integrations/payments-adyen-mollie-square-braintree.md
