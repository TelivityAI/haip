# Frankfurter / ECB FX (recipe)

Use **[Frankfurter](https://www.frankfurter.app/)** (ECB reference rates) in your own reporting or middleware. HAIP does **not** embed a Frankfurter Nest client — amounts in the PMS stay in the property’s configured currency.

## When to use this

- Nightly multi-currency dashboards outside HAIP
- Converting accounting CSV exports or report totals for a holding-company GL
- Display helpers in a custom booking widget that already talks to HAIP REST

## Pattern

1. Export or query HAIP figures in property currency ([accounting CSV](accounting-csv.md), reports APIs, or read-only BI Postgres — [bi-postgres.md](bi-postgres.md)).
2. From your scheduler, call Frankfurter’s public HTTP API (see frankfurter.app docs for paths such as `/v1/latest` and `/v1/{date}`).
3. Apply rates in your warehouse or spreadsheet — do not write FX tables back into HAIP production schemas from BI tools.

## Honesty notes

- ECB reference rates are not a payment FX feed; settlement rates come from your acquirer/PSP.
- No HAIP env vars or registry `adapterKey` — catalog status is `recipe`.
- Do not invent HAIP FX endpoints; convert outside the PMS.

## Demo

```bash
./integrations/demos/run.sh frankfurter-ecb-fx
```

Enables the catalog row; live rate fetch happens in your middleware against Frankfurter.
