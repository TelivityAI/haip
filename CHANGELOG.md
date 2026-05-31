# Changelog

All notable changes to HAIP are documented here. This project adheres to
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added — Accounting & Cashiering

A new accounting layer that makes HAIP's financials correct-by-construction,
not just functional.

- **Deposit Ledger** — advance deposits are now tracked as a **liability**, not
  revenue, with a full recognition lifecycle: `held → applied → refunded /
  forfeited`, including refundable vs. non-refundable handling and
  status-transition guards. New `/deposits` endpoints and `deposit.*` webhook
  events.
- **Accounts Receivable (A/R)** — named A/R ledgers for post-stay direct billing.
  Transfer an outstanding folio balance to A/R (zeroing the folio), record A/R
  payments, reverse transfers with a preserved audit trail, and view aging
  buckets (0–30 / 31–60 / 61–90 / 90+). New `/ar/*` endpoints and `ar.*` webhook
  events.
- **Cash Drawer & Cashiering** — per-drawer cash tracking with shift sessions,
  cash movements (payment, refund, paid-out, drop), shift close with
  expected-vs-counted **variance** detection, and a cashier's report. New
  `/cash/*` endpoints and `cashdrawer.*` webhook events.
- **Daily Trial Balance** — reconciliation across the Deposit, Guest, and A/R
  ledgers. New `GET /reports/trial-balance` endpoint.
- **Custom Accounting Codes** — user-defined transaction and General Ledger (GL)
  codes for export to external accounting systems. New `/accounting/codes`
  endpoints.

### Changed
- API surface grew to ~125 endpoints (+27: 20 accounting, 7 cashier, plus the
  trial-balance report).
- Webhook catalog grew to **48 event types** (+11 accounting events).
- Test suite: **605 tests across 50 files** (was 551 across 45), all passing —
  23 new tests (deposit 8, A/R 8, cashier 7).

### Notes
- All new property-scoped tables enforce `property_id` multi-tenancy: every
  read/update/delete filters by both `id` and `propertyId`.
- Money math uses `decimal.js` with `numeric(12,2)` storage throughout.
- 7 new tables and 6 new enums, added to the idempotent `push-schema.ts`
  migration.
- The A/R transfer-to-zero is a ledger move (reuses the folio adjustment path),
  not a payment, per the deposit/A/R domain rules.

## [0.1.0]

Initial public baseline: reservations, folios, rate plans, rooms, guests,
housekeeping, night audit, reports, channel manager, payments (Stripe), tax
engine, webhooks, Connect API, and the 9-agent AI framework.
