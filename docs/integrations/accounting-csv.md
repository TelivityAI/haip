# Accounting CSV export (QuickBooks, Xero, Sage)

HAIP exports daily accounting summaries as **plain CSV** for import into your general ledger or spreadsheet workflow. There is no hosted OAuth connector to accounting SaaS — you control the file hand-off.

## Endpoints

Staff-authenticated routes (Keycloak, permission **`reports.view`**, role **`admin`**):

```http
GET /api/v1/accounting-export/revenue-journal.csv?propertyId=<uuid>&date=YYYY-MM-DD
GET /api/v1/accounting-export/trial-balance.csv?propertyId=<uuid>&date=YYYY-MM-DD
```

Responses:

- `Content-Type: text/csv`
- `Content-Disposition: attachment` with filename `revenue-journal.csv` or `trial-balance.csv`

`propertyId` is required and UUID-validated (multi-tenancy).

OpenAPI tag: **accounting-export**.

## Revenue journal CSV

Columns: `date`, `category`, `account`, `amount`

Categories include revenue breakdown (room, tax, F&B, other, total), adjustments, net revenue, and payment methods — sourced from the same daily revenue report used in the dashboard.

## Trial balance CSV

Columns: `date`, `ledger`, `opening`, `netActivity`, `transfersIn`, `transfersOut`, `closing`

One row per ledger for the business date.

## Hand-off workflow

1. **Scheduled export** — cron or night-audit automation calls the URLs with a service account token (same auth as staff API).
2. **Import** — map CSV columns to your chart of accounts:
   - **QuickBooks** — Banking / import spreadsheet, or third-party CSV import tools
   - **Xero** — Manual journal or bank import templates (map `account` / amounts)
   - **Sage** — CSV import per your localization module
3. **Custom GL codes** — maintain mapping codes in HAIP via `/api/v1/accounting/codes` if you align export accounts with an external COA (see OpenAPI **accounting** tag).

## Custom transaction codes

Use HAIP accounting code APIs to label transaction types before export if your bookkeeper expects stable external account numbers. Export files themselves are aggregate daily views — pair them with detailed folio or payment reports from `/api/v1/reports/*` when auditors need line-level support.

## Related events

Accounting-related webhook events (for example `deposit.received`, `cashdrawer.session_closed`) are listed in the shared event catalog referenced from **[Webhooks & events](../webhooks.md)**. CSV export complements events; it does not replace statutory fiscal document flows (`invoice.*`), which use folio fiscal-document APIs in the same webhooks doc.
