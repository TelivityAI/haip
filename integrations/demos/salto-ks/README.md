# Salto KS — demo

One command (API must be running — `docker compose up`):

```bash
./integrations/demos/run.sh salto-ks
# or:
./integrations/demos/salto-ks/demo.sh
```

What it does:
1. Turns **ON** the property Integrations catalog toggle for `salto-ks` (same as the dashboard button).
2. Applies the demo wiring for this provider (channel connection / fiscal config / env hints).
3. Runs in **mock/console** mode when vendor keys are missing — no paid partner account required for the demo path.


## Env

See [`demo.env.example`](./demo.env.example). Process-level providers (payments, SMS, locks) need an API restart after changing env.

## Docs

[docs/integrations/door-locks-nuki-ttlock-salto.md](../../docs/integrations/door-locks-nuki-ttlock-salto.md)
