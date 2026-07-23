# HAIP — Roadmap

Open-source, API-first hotel PMS (Apache 2.0).

## Shipped
- Reservations, front desk, check-in/out
- Folios, billing, payments (Stripe)
- Rate plans, housekeeping, night audit
- Groups, cashiering, house accounts, accounting, tax
- Channel distribution + commission-free direct booking engine
- Multi-property, RBAC, audit logging
- **HAIP AI** — optional local model (Ollama) that explains the deterministic
  agents' decisions in plain language, grounded so it can't invent figures.
  Runs on your own hardware, off by default.
- Upsells & ancillaries — [#174](https://github.com/telivityai/haip/pull/174) (services catalog, packages, booking/front-desk/pre-arrival channels)
- Money policy — [#175](https://github.com/telivityai/haip/pull/175) (cancellation policies, deposit settlement on cancel/no-show/check-in)
- Front desk stay ops — [#181](https://github.com/telivityai/haip/pull/181) (room move, walk-in, arrivals queue, registration card, notes)
- A/R & cashier desk polish — [#180](https://github.com/telivityai/haip/pull/180) (list drawers/sessions, ledger CRUD UI, folio→A/R, aging UX)
- Commercial profiles — [#180](https://github.com/telivityai/haip/pull/180) / [#179](https://github.com/telivityai/haip/pull/179) (billing terms on group profiles, A/R + negotiated rate links)

## Planned
- New-property onboarding wizard
- Complete guest registration (ID, minors/guardian, per-jurisdiction compliance — deeper than desk card)
- Loyalty (guest recognition, tiers, rewards)
- Expanded AI assistance (grounded explanations, suggestions, per-property calibration)
- Expanded channel/OTA connectivity
- Revenue management (pricing, demand, booking pace, forecasting)
- Business intelligence & analytics (own-property demand, pickup, pace, RevPAR)
- Deeper reporting and exports
- Hardening & reliability (integration retries/timeouts, observability, scale)
- Additional localizations
- HK ops depth, rates depth, groups depth

## In progress
- Production deployment path (compose, container images, docs)
- Full dashboard localization (page-level i18n)
- End-to-end + money-path test coverage
- Guest journey (lifecycle guest-comms triggers, communications ops, registration settings, messaging UI)

Contributions welcome — open an issue or a draft PR to claim an area, and tag a
maintainer to coordinate before starting larger work.
