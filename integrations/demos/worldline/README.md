# Worldline Online Payments — demo

One command (API must be running):

```bash
./integrations/demos/run.sh worldline
```

What it does:

1. Turns **ON** the property Integrations catalog toggle for `worldline`.
2. Notes process env (`PAYMENT_GATEWAY=worldline`) — restart the API after changing it.
3. Requires a merchant id, API key id, and API secret. Missing credentials fail closed. For an offline demo, select `PAYMENT_GATEWAY=mock`.

## Env

See [`demo.env.example`](./demo.env.example). Use the test host. Do not commit live secrets.

## Docs

[docs/integrations/payments-worldline.md](../../docs/integrations/payments-worldline.md)
