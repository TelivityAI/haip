# HAIP — Hotel AI Platform

Open-source, API-first hotel PMS. Full project documentation lives on [`main`](https://github.com/TelivityAI/haip/blob/main/README.md).

## Production checklist

Before going live, verify [`docs/deployment.md`](./docs/deployment.md) and [`docs/operations/cron.md`](./docs/operations/cron.md). Run the operator harden pack ([`ops/harden/`](./ops/harden/)):

```bash
pnpm harden:local
pnpm harden:live
```

See also [`ops/harden/PRODUCTION.md`](./ops/harden/PRODUCTION.md).
