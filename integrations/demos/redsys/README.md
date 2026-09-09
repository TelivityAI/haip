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
3. Works in **console** mode when FUC/secret are missing (no live Spanish bank account required for the demo path).

## Env

See [`demo.env.example`](./demo.env.example).

## Docs

[docs/integrations/payments-redsys.md](../../docs/integrations/payments-redsys.md)
