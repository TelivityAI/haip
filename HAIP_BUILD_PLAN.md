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
- Upsells & ancillaries (services catalog, packages, booking/front-desk/pre-arrival channels)
- Money policy (cancellation policies, deposit settlement on cancel/no-show/check-in)

## Planned
- New-property onboarding wizard
- Complete guest registration (ID, minors/guardian, per-jurisdiction compliance)
- Loyalty (guest recognition, tiers, rewards)
- Expanded AI assistance (grounded explanations, suggestions, per-property calibration)
- Expanded channel/OTA connectivity
- Revenue management (pricing, demand, booking pace, forecasting)
- Business intelligence & analytics (own-property demand, pickup, pace, RevPAR)
- Deeper reporting and exports
- Hardening & reliability (integration retries/timeouts, observability, scale)
- Additional localizations
- Guest journey, HK ops depth, rates depth, groups depth

## In progress
- Production deployment path (compose, container images, docs)
- Full dashboard localization (page-level i18n)
- End-to-end + money-path test coverage
- Front desk stay ops (room move, walk-in, arrivals queue, registration at check-in)
- A/R & cashier desk polish (list drawers/sessions, ledger CRUD UI, folio→A/R, aging UX)
- Commercial profiles (billing terms on group profiles, A/R + negotiated rate links)

Contributions welcome — open an issue or a draft PR to claim an area, and tag a
maintainer to coordinate before starting larger work.
