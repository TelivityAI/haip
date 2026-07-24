# HAIP — Roadmap

Open-source, API-first hotel PMS (Apache 2.0).

Statuses below are verified against `main` (merged PRs + modules in repo). Detail for recent vertical cuts: [README — Shipped product slices](README.md#shipped-product-slices). Remaining catalog integrations: [docs/plans/integrations-planned-backlog.md](docs/plans/integrations-planned-backlog.md).

## Shipped

### Core PMS
- Reservations, front desk, check-in/out
- Folios, billing, payments (Stripe; also Adyen / Mollie / Square / Braintree; Wise console)
- Rate plans, housekeeping, night audit
- Groups, cashiering, house accounts, accounting, tax
- Channel distribution + commission-free direct booking engine
- Multi-property, RBAC, audit logging

### Revenue management & own-property analytics (in-product)
- **Revenue Manager** orchestrator + demand forecast, dynamic pricing, overbooking, channel mix, group pickup agents (`apps/api/src/modules/agent/`, Revenue dashboard)
- Reports: occupancy, ADR/RevPAR, pickup, booking pace, daily revenue, financial summary, trial balance (`/api/v1/reports/*`)
- Accounting CSV export (`/api/v1/accounting-export/*`)

### HAIP AI
- Optional local model (Ollama) that explains deterministic agents’ decisions in plain language, grounded so it can’t invent figures (`POST /api/v1/help/explain`). Runs on your hardware, off by default.

### Recent product slices (merged)
- Upsells & ancillaries — [#174](https://github.com/TelivityAI/haip/pull/174)
- Money policy — [#175](https://github.com/TelivityAI/haip/pull/175)
- Front desk stay ops — [#181](https://github.com/TelivityAI/haip/pull/181)
- A/R & cashier desk polish — [#180](https://github.com/TelivityAI/haip/pull/180)
- Commercial profiles — [#180](https://github.com/TelivityAI/haip/pull/180) / [#179](https://github.com/TelivityAI/haip/pull/179)
- Guest journey polish — [#182](https://github.com/TelivityAI/haip/pull/182) (lifecycle triggers, communications desk, registration settings, email compose)
- Rates depth — [#183](https://github.com/TelivityAI/haip/pull/183) (restrictions CRUD, derived-rate create, effective-rate fix, PMS `assertSellable`)
- Distribution polish + guest journey depth + property ops — [#202](https://github.com/TelivityAI/haip/pull/202) (rate-parity UI, mapping editor, content-push errors; pre-register API; SMS; L&F / discrepancies compute / service requests / locks)
- Un-thin waves A–D — [#205](https://github.com/TelivityAI/haip/pull/205) (persisted discrepancy cases, turnaway/waitlist, loyalty points ledger, WhatsApp templates, folio inbound, booking deep links, distro runbooks) — see [`docs/plans/unthin-backlog.md`](docs/plans/unthin-backlog.md)
- Wave 3 Tier A/B integrations — messaging/email shipped paths, channel + review consoles, BI/accounting/POS/CRM/FX recipes (#240, #245–#248); one-command enable under `integrations/demos/`

## In progress
- Production deployment hardening (compose + [`docs/deployment.md`](docs/deployment.md) exist; production-grade images/observability/scale still open)
- Full dashboard localization (en / de / pt-BR present; page-level coverage incomplete)
- End-to-end + money-path test coverage
- Guest-facing surfaces still later: guest app, kiosk UI (API pre-register / messaging already shipped)

## Planned
- New-property onboarding wizard
- Complete guest registration (ID, minors/guardian, per-jurisdiction compliance — deeper than desk registration card)
- Loyalty **tiers** / external points-bank adapters (MVP award ledger already shipped in #205)
- Expanded AI assistance (suggestions, per-property calibration beyond grounded explain)
- Expanded channel/OTA **direct** connectivity (next OTAs after certify path; Google Hotel Center if needed)
- **External** revenue-management / market-data partners (IDeaS, Duetto, PriceLabs, …) — see integrations planned backlog; in-product RM agents are already shipped
- Deeper BI beyond own-property reports (partner Demand360 / Top-Report; richer exports)
- Hardening & reliability (integration retries/timeouts, observability, scale)
- Additional localizations
- HK ops depth, groups depth (beyond what #202 / #205 already landed)
- Remaining catalog `planned` rows (**86**) — collaborator inventory + build order in [`docs/plans/integrations-planned-backlog.md`](docs/plans/integrations-planned-backlog.md)

Contributions welcome — open an issue or a draft PR to claim an area, and tag a
maintainer to coordinate before starting larger work.
