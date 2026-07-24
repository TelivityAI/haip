# pmsXchange (SiteMinder) — demo

One command (API must be running — `docker compose up`):

```bash
./integrations/demos/run.sh pmsxchange-siteminder
# or:
./integrations/demos/pmsxchange-siteminder/demo.sh
```

What it does:
1. Turns **ON** the property Integrations catalog toggle for `pmsxchange-siteminder` (same as the dashboard button).
2. Applies the demo wiring for this provider (channel connection / fiscal config / env hints).
3. Runs in **mock/console** mode when vendor keys are missing — no paid partner account required for the demo path.


## Env

See [`demo.env.example`](./demo.env.example). Process-level providers (payments, SMS, locks) need an API restart after changing env.

## Docs

[docs/INTEGRATIONS.md#channel-managers](../../docs/INTEGRATIONS.md#channel-managers)
