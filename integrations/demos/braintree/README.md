# Braintree — demo

One command (API must be running — `docker compose up`):

```bash
./integrations/demos/run.sh braintree
# or:
./integrations/demos/braintree/demo.sh
```

What it does:
1. Turns **ON** the property Integrations catalog toggle for `braintree` (same as the dashboard button).
2. Applies the demo wiring for this provider (channel connection / fiscal config / env hints).
3. Runs in **mock/console** mode when vendor keys are missing — no paid partner account required for the demo path.


## Env

See [`demo.env.example`](./demo.env.example). Process-level providers (payments, SMS, locks) need an API restart after changing env.

## Docs

[docs/integrations/payments-adyen-mollie-square-braintree.md](../../docs/integrations/payments-adyen-mollie-square-braintree.md)
