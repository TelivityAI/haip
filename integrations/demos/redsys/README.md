# Redsys — demo

One command (API must be running):

```bash
./integrations/demos/run.sh redsys
# or:
./integrations/demos/redsys/demo.sh
```

What it does:
1. Turns **ON** the property Integrations catalog toggle for `redsys`.
2. Notes process env (`PAYMENT_GATEWAY=redsys`) — restart the API after changing it.
3. Requires configured sandbox or live merchant credentials for Redsys. For a deliberate offline demo, select `PAYMENT_GATEWAY=mock` and restart the API; unconfigured Redsys operations fail closed.

## Env

See [`demo.env.example`](./demo.env.example).

## Docs

[docs/integrations/payments-redsys.md](../../docs/integrations/payments-redsys.md)
