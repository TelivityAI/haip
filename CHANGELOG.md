# Changelog

All notable changes to HAIP are documented here. This project adheres to
[Semantic Versioning](https://semver.org/).

## [Unreleased]

> Version numbers and release tags are assigned automatically by the release
> workflow on merge — this section is intentionally left as _Unreleased_.

### Added — Housekeeping ops depth

- **Lost & found** — `lost_and_found_items` table and CRUD API; items tagged with
  auto-generated codes and a 90-day hold period before disposal.
- **Room status discrepancies** — `GET /rooms/discrepancies?propertyId=&date=`
  computes mismatches between room status and in-house reservations (occupied without
  guest, vacant with in-house stay).
- **Service requests** — guest/staff work orders that can spawn linked housekeeping
  tasks (`POST /service-requests/:id/create-task`).
- **Permissions** — `ops.read` / `ops.manage` for property ops endpoints.
- **Dashboard** — Lost & Found and Service Requests tabs under Housekeeping;
  discrepancies panel on the Rooms page. i18n: en + pt-BR.

### Added — Guest journey (ops + lifecycle triggers)

- **Guest-comms event listener** — `reservation.created` / `checked_in` / `checked_out`
  draft confirmation / welcome / post-stay emails via the guest_comms agent (failures
  never break reservation state changes).
- **Communications desk** — reject pending drafts; manual **Run guest-comms** for
  scheduled / bulk drafts.
- **Registration policy** — Settings toggle for `guestRegistrationRequired`.
- **Check-in ID fields** — Front Desk captures `idCountry` / `idExpiry` with type/number.
- **Guest profile** — company name, marketing consent, ID document display/edit.
- **Reservation messaging UI** — compose guest email from reservation detail
  (`POST /reservations/:id/messages`, GDPR marketing flag).
- **Docs** — README shipped-slices table (upsells → commercial) with PR links.

### Added — Front desk stay ops

- **Room move** — `PATCH /reservations/:id/move-room` for assigned/in-house stays;
  vacates old room / occupies new; respects `doNotMove` with optional override.
- **Walk-in** — Front Desk Walk-In creates guest → reservation (`walk_in`) → assign,
  then opens check-in.
- **Arrivals queue** — lists `confirmed` + `assigned`; unassigned badge; in-house
  includes `stayover` / `due_out`.
- **Registration card** — check-in persists `registrationData` and requires signed
  card when `guestRegistrationRequired`.
- **Notes** — Front Desk + Reservations detail surface operational notes API.

### Added — Commercial profiles (KB 14.3 standing accounts)

- **Billing fields on group profiles** — `billingAddress`, `paymentTermsDays` (same shape as
  city-ledger / A/R).
- **Links** — optional `groupProfileId` on `ar_ledgers` and `rate_plans` (FK ownership
  scoped by propertyId).
- **`GET /groups/profiles/:id/commercial`** — profile plus linked A/R ledgers and rate plans.
- **Dashboard** — Commercial profiles page (corporate / travel agent / wholesale) with
  create + create-linked A/R ledger.
- Permission: `commercial.read`. Demo seed links Acme + Convention Bureau profiles to A/R.

### Added — A/R & cashier desk polish

- **Cash drawers list** — `GET /cash/drawers?propertyId=` (dashboard no longer relies on
  `localStorage` drawer ids).
- **Session resume** — `GET /cash/sessions?propertyId=&cashDrawerId=&status=open`; open
  shift uses the drawer starting float when `openingFloat` is omitted.
- **A/R ledger UX** — create/close ledgers in Accounting; `GET /ar/ledgers/:id/transactions`
  for reverse-transfer picker; property-wide `GET /ar/aging`.
- **Folio → A/R** — Transfer to A/R action on folio detail (existing `POST /ar/transfer`).
- Demo seed: 2 A/R ledgers + 2 cash drawers.

### Added — Money policy (cancellation + deposit settlement)

- **Cancellation policies** — property-scoped rules (free-cancel hours, penalty type,
  deposit handling) linked from rate plans via `cancellationPolicyId`.
- **Policy evaluator** — shared cancel/no-show math for PMS, Connect, and booking engine.
- **Deposit settlement** — cancel refunds or forfeits held deposits; check-in auto-applies
  held deposits to the guest folio; night audit settles no-shows (plus optional property
  `noShowFeeAmount`, honors `noShowCutoffHour`).
- Permissions: `policies.read` / `policies.manage`.
- Webhooks: `cancellation_policy.created|updated|deleted`; `reservation.no_show` emitted.

### Added — Stay extras & packages (upsells)

- **Services catalog** — property-scoped sellable extras with charge type, price,
  posting rule (`once` / `per_night` / `on_consumption` / `included_in_rate`), and
  sell channels (`booking_engine` / `front_desk` / `pre_arrival`).
- **Rate plan components** — package rate plans can bundle catalog services.
- **Reservation services** — attach extras to a stay from front desk or booking;
  price snapshot + status lifecycle.
- **Posting** — check-in posts `once` / included lines; night audit posts `per_night`
  (idempotent); folio routing and tax apply as usual.
- **Booking engine + widget** — optional `serviceIds` on quote/book; `/extras` step
  in the guest booking flow; `GET /booking-engine/services`.
- **Pre-arrival** — guest-comms includes an extras prompt when `upsellEnabled`.
- Permissions: `services.read` / `services.manage`.

### Added — DerbySoft Property Connector adapter

- **DerbySoft channel adapter** (`adapterType: derbysoft`) — REST/JSON + OAuth Bearer,
  15 req/s client limiter, Delta/Overlay ARI (inventory/rate/availability), property
  profile sync, inbound LiveCheck/Book/Modify/Cancel/Ping with Bearer auth.
- **Mock PC server** on `:4002` (`tools/mock-derbysoft`, compose profile `channels`).
- **Docs + partner checklist** — `docs/channels/derbysoft.md` (`pms.service@derbysoft.net`).
- PCI: inbound payment card fields stripped before persistence.

### Added — Multi-arch GHCR images + VPS/cloud deploy guides

- **Multi-platform GHCR publish** — release workflow builds `linux/amd64` and
  `linux/arm64` for `ghcr.io/telivityai/haip-api` via Buildx/QEMU.
- **Deployment docs** — VPS self-host steps plus Render / Railway / AWS / GCP
  sketches in `docs/deployment.md` (closes remaining BRIEF-020 deploy gaps).

### Added — Staff branding, contextual help, report favorites & KPI thresholds

- **Staff dashboard white-label** — property fields for display name, logo, primary/accent
  colors (separate from guest booking-engine branding); applied in Sidebar / CSS vars.
- **Contextual help** — route help panel (`GET /v1/help`) plus optional grounded
  HAIP AI explain (`POST /v1/help/explain`).
- **Report favorites** — `users.preferences.reportFavorites` via `GET/PATCH /v1/admin/me/preferences`.
- **KPI warn thresholds** — `properties.settings.kpiThresholds` tint Dashboard KPI cards.

### Added — Portfolio, search, staff alerts, export automation

- **Portfolio rollup** — `organizations` table, optional `organization_id` on properties,
  `GET /v1/reports/portfolio/*` endpoints, dashboard **All Properties** mode with
  aggregated KPIs and per-property breakdown.
- **Universal search** — `GET /v1/search` and `GET /v1/search/portfolio`; dashboard
  command palette (⌘K / Ctrl+K) across guests, reservations, folios, rooms, groups.
- **Staff notifications** — in-app alerts with websocket push; populated from
  `agent.decision_created` and `audit.completed`; notification bell in the header.
- **Accounting export automation** — on `audit.completed`, pre-generates CSV exports
  and emits `accounting.export.ready` webhook with download paths.

### Added — Revenue Manager (RManager) Agent

- **Revenue Manager orchestrator agent** (`revenue_manager`) — a meta-agent that
  runs the revenue sub-agents in dependency order (demand → pricing, overbooking,
  channel mix, group pickup) and reconciles their outputs into one coherent
  revenue strategy. Grounded in established RM doctrine: optimizes **GOPPAR** over
  raw revenue, moves price with demand band and booking pace, protects peak dates
  with length-of-stay controls and zero overbooking, enforces rate-grid integrity
  (no discount fires on strong demand), evaluates group displacement on net
  contribution, and treats discounting as a last resort.
- Pure, unit-tested decision logic (`revenue-manager.models.ts`, 20 tests):
  demand-band classification, RevPAR/GOPPAR, the identical-net-revenue rule,
  group-displacement accept test, per-date stance derivation, and horizon
  synthesis with projected RevPAR/GOPPAR.
- Adds `revenue_manager` to the `agent_type` enum (schema + idempotent push).

### Added — Reservation Operations

- **Bulk actions** — check-in / check-out / cancel across many reservations in
  one call, with per-reservation success/error results (never aborts the batch).
- **Reservation notes** — notes per reservation with active-count tracking.
- **Guest messaging** — compose and send a message to a reservation's guest;
  marketing messages respect the guest's GDPR opt-out.
- **Unassigned-reservation finder** — list confirmed/assigned reservations that
  have no room assigned, in a date window.
- **Batch reservation import** — create many reservations from pre-parsed rows
  with per-row error handling.
- New `reservation.*` ops webhook events; `reservation_notes` table.
- **Deliberate non-feature:** reservation status reversion ("un-cancel") is
  intentionally NOT implemented (payment-integrity hazard, KB §14.8) — enforced
  by a regression test.

### Added — Groups & Allotment Engine

- **Group profiles** for corporate / travel-agent / wholesale / event business,
  with an optional group (master) folio and computed group invoices.
- **Allotment blocks** — hold rooms per date and room type at negotiated rates,
  with cutoff dates, shoulder dates, and Min/Max LOS. Inventory is validated
  against live availability to prevent over-allotment.
- **Cutoff & auto-release** — `POST /groups/blocks/:id/release` plus a
  `POST /groups/blocks/process-cutoffs` sweep that frees unsold rooms from all
  expired auto-release blocks back to general inventory (endpoint-triggered; no
  in-process cron, per repo convention).
- **Pickup tracking** — rooms allotted vs. picked up per date/room-type.
- **Rooming lists** — batch import that creates and links member reservations
  with per-row success/error handling.
- **Group Pickup Forecasting agent** (new agent type `group_pickup`, 11 agents
  total) — projects final pickup vs. wash and recommends hold / partial-release
  / full-release ahead of cutoff.
- New `group.*` webhook events; `reservations.group_profile_id` added.

### Added — Split Folios & House Accounts

- **House Accounts** — a non-guest ledger for walk-in retail, bar/restaurant,
  vendor, or internal sales not tied to any reservation. Open/close lifecycle,
  a `products` retail catalog, and charge/payment posting on the same unified
  ledger as folios. New `/house-accounts` + `/products` endpoints and
  `houseaccount.*` webhook events.
- **Split Folio** — multiple folios per reservation with config-driven routing
  rules (room & tax → company, incidentals → guest) and move-transactions
  between folios (individually or by charge type; night-audit-locked charges are
  protected). New `/folios/routing-rules` and `/folios/:id/move-transactions`
  endpoints.
- **Payment Correction Matrix** — `POST /payments/:id/correct` picks the safe
  operation by payment state: **void** uncaptured authorizations (and same-day
  cash), **refund** captured cards, or post a compensating **adjustment**.
  Illegal overrides (e.g. voiding a captured card) are rejected.
- Schema: `charges`/`payments` now belong to **either** a folio **or** a house
  account (`folio_id` nullable + nullable `house_account_id`).

### Added — AI Intelligence Layer (accounting)

AI on top of the new accounting layer — a differentiator with no equivalent in
the baseline feature set. HAIP now ships **10 built-in agents** (was 9).

- **A/R Collections Prioritization agent** (new agent type `ar_collections`) —
  ranks open Accounts Receivable ledgers by collection priority (balance × days
  overdue beyond terms × open-transfer count) into low/medium/high tiers with a
  recommended action.
- **Cash-variance anomaly detection** — the Night Audit Anomaly agent now scans
  closed cashier shifts and flags over/short drawer variances
  (`cash_variance_outlier`, 11 anomaly types total).
- **Deposit-forfeit risk scoring** — the Cancellation Prediction agent now scores
  held deposits as likely-forfeit vs. likely-refund with exposure amounts
  (additive `depositRisk` on each reservation score).

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
- API surface grew to ~165 endpoints (+66: 20 accounting, 7 cashier, 11 house
  accounts/products, 3 split-folio, 16 groups/allotment, 8 reservation-ops, plus
  payment-correct and the trial-balance report).
- Webhook catalog grew to **64 event types** (+27: 11 accounting, 7 house-account
  & folio, 6 groups, 3 reservation-ops).
- Test suite: **691 tests across 61 files** (was 551 across 45), all passing —
  140 new tests across the accounting, AI-hook, house-account, split-folio,
  payment-correction, groups/allotment, and reservation-ops features.
- No manual version bumps — the release workflow tags the next version on merge.

### Notes
- All new property-scoped tables enforce `property_id` multi-tenancy: every
  read/update/delete filters by both `id` and `propertyId`.
- Money math uses `decimal.js` with `numeric(12,2)` storage throughout.
- 7 new tables and 6 new enums, added to the idempotent `push-schema.ts`
  migration.
- The A/R transfer-to-zero is a ledger move (reuses the folio adjustment path),
  not a payment, per the deposit/A/R domain rules.

## [1.2.5] and earlier

Prior baseline (released via git tags v1.0.0 → v1.2.5): reservations, folios,
rate plans, rooms, guests, housekeeping, night audit, reports, channel manager,
payments (Stripe), tax engine, webhooks, Connect API, and the 9-agent AI
framework. See GitHub Releases for the per-tag history.
