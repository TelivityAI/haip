# HAIP — Build Plan

> Updated April 6, 2026 — Phase 7 complete. Competitive milestone reached.
> Name: HAIP (Hotel AI Platform). Separate repo from OTAIP.

---

## THE PRODUCT

An open-source, TypeScript/Node.js, API-first hotel PMS with native OTAIP agent orchestration and air booking. The only PMS in the world where AI agents are first-class citizens, not bolted-on afterthoughts. 


---

## ARCHITECTURE DECISION

**Option A — OTAIP agents ARE the PMS** (agents handle reservations, folios, housekeeping directly)
**Option B — PMS is a standalone system, OTAIP agents sit on top via APIs**

**Decision: Option B.** The PMS is a real PMS — it works without OTAIP. OTAIP agents connect via the same APIs any third party would use. This is how Apaleo's Agent Hub works. It keeps the PMS useful to people who don't want AI, and keeps the agent layer clean.

The PMS IS the product. OTAIP agents are the magic that makes it Telivity's.

**Confirmed by Dušan — April 5, 2026.**

---

## TECH STACK

- **Language:** TypeScript (strict mode)
- **Runtime:** Node.js >=20
- **Framework:** NestJS (modular, dependency injection, OpenAPI generation built-in)
- **Database:** PostgreSQL (multi-tenant from day one)
- **ORM:** Drizzle ORM (TypeScript-native, fast, no magic)
- **Cache:** Redis (session management, rate caching, pub/sub for events)
- **Message Queue:** BullMQ on Redis (webhook delivery, async tasks, night audit jobs)
- **API:** REST (JSON/HTTPS), OpenAPI 3.0 auto-generated from decorators
- **Auth:** OAuth 2.0 / OpenID Connect (Passport.js)
- **Package Manager:** pnpm (matches OTAIP)
- **Testing:** Vitest (matches OTAIP)
- **Build:** tsup (matches OTAIP)
- **Containerization:** Docker + docker-compose for self-hosting
- **CI/CD:** GitHub Actions

---

## BUILD PHASES

### Phase 0 — Scaffolding & Data Model (Week 1-2)
**2 Claude Code sessions**

What gets built:
- Monorepo scaffolding (pnpm workspace, same structure as OTAIP)
- PostgreSQL schema: properties, rooms, room_types, reservations, guests, folios, charges, payments, rate_plans, rate_restrictions
- Multi-tenant schema design (property_id on every table, row-level security)
- NestJS app bootstrap with module structure
- OpenAPI/Swagger generation
- Docker-compose for local dev (Postgres + Redis + app)
- CLAUDE.md constitution (no invented domain logic rule)
- CI pipeline (lint, type-check, test)

**Deliverables:** Working NestJS app with database migrations, empty API endpoints, docker-compose, CI green.

**Estimate:** 2 sessions × 3-4 hours each = ~8 hours Claude Code time

---

### Phase 1 — Reservation Lifecycle (Week 2-4)
**3-4 Claude Code sessions**

What gets built:
- **Reservation module:** Create, read, update, cancel reservations
- **State machine:** Pending → Confirmed → Assigned → Checked In → Stayover → Due Out → Checked Out (+ No-Show, Cancelled)
- **Availability engine:** Room inventory by type per date, overbooking allowance
- **Guest profile module:** CRUD, preferences, stay history
- **Rate plan module:** BAR, derived, negotiated, package rates; MinLOS/MaxLOS/CTA/CTD restrictions
- **Room assignment:** Automated matching based on type, preferences, accessibility
- **Booking API:** Search availability → Select rate → Create reservation → Confirm
- Webhook events: reservation.created, reservation.confirmed, reservation.cancelled, reservation.modified

**Deliverables:** Working booking API. Can create a property, define rooms and rates, search availability, book, modify, cancel. All states work. Webhooks fire.

**Estimate:** 4 sessions × 3-4 hours = ~14 hours Claude Code time

---

### Phase 2 — Folio & Billing (Week 4-6)
**3 Claude Code sessions**

What gets built:
- **Folio module:** Guest folio, master folio, split folio, city ledger
- **Charge posting:** Room charges, F&B, incidentals, adjustments
- **Folio routing:** Charges route to correct folio based on rules
- **Payment abstraction:** Stripe gateway integration (first gateway)
- **Pre-authorization:** Hold at check-in, incremental auth, final settlement
- **Tokenization:** PCI-compliant payment token storage (never store card data)
- **Settlement:** Cash, card, city ledger transfer, balance verification
- Webhook events: folio.charge_posted, payment.received, folio.settled

**Deliverables:** Complete billing flow. Check-in creates folio, charges post, payments settle, checkout zeroes balance. Stripe integration works.



---

### Phase 3 — Check-In/Check-Out & Front Desk (Week 6-7)
**2 Claude Code sessions**

What gets built:
- **Check-in flow:** ID verification fields, key card data prep, deposit auth, room assignment
- **Check-out flow:** Folio review, payment collection, room status update
- **Express checkout:** Automated settlement, email receipt
- **Group check-in:** Master list import, batch assignment
- **Early check-in / Late checkout:** Request handling, fee calculation
- **Room status updates:** Trigger housekeeping on checkout

**Deliverables:** Full front desk operations. Check-in to checkout works end-to-end including group scenarios.

---

### Phase 4 — Housekeeping (Week 7-8)
**2 Claude Code sessions**

What gets built:
- **Room status state machine:** Dirty → Clean → Inspected → Guest Ready → Assigned
- **Task assignment:** Auto-assign rooms to housekeepers based on floor/priority
- **Checklist module:** Digital inspection checklists per room type
- **Turn-time tracking:** Analytics on cleaning time per room
- **Maintenance requests:** OOO/OOS status, repair tracking
- **Dashboard API:** Real-time status of all rooms for front desk and housekeeping
- Webhook events: room.status_changed, housekeeping.task_assigned, housekeeping.task_completed

**Deliverables:** Working housekeeping module. Room status transitions work, tasks auto-assign, checklists trackable.


---

### Phase 5 — Night Audit & Reporting (Week 8-9)
**2 Claude Code sessions**

What gets built:
- **Night audit job:** Automated via BullMQ cron
  - Post room tariffs to all active folios
  - Process no-shows (cancel + apply fee)
  - Revenue reconciliation
  - Day close (lock previous day, roll to new day)
- **Reports API:**
  - Daily revenue report (room, F&B, other)
  - Occupancy report (rooms occupied, available, OOO)
  - Financial summary (totals by payment method)
  - ADR, RevPAR, occupancy rate calculations
- **Audit log:** All transactions locked after day close

**Deliverables:** Night audit runs automatically, posts charges, processes no-shows, generates reports. Day close works.


---

### Phase 6 — Channel Manager Integration (Week 9-11)
**3 Claude Code sessions**

What gets built:
- **ARI push:** Availability, Rates, Inventory push to channel managers
- **Reservation pull:** Receive bookings from OTAs via channel manager
- **OpenTravel XML support:** OTA_HotelAvailNotif, OTA_HotelResNotif, OTA_HotelRateAmountNotif
- **SiteMinder adapter** (first channel manager integration)
- **Two-way sync:** Booking on any channel instantly updates inventory everywhere
- **Rate parity enforcement:** Same rate across all channels unless fenced

**Deliverables:** PMS connected to a channel manager. Rates push out, bookings come in, inventory stays in sync. Hotel is bookable on OTAs.


---

### Phase 7 — OTAIP Agent Layer (Week 11-13)
**3-4 Claude Code sessions**

What gets built:
- **PMS Connect Adapter:** OTAIP ConnectAdapter interface for the hotel PMS (same pattern as AmadeusAdapter, DuffelAdapter)
- **Hotel Search Agent (4.1):** Multi-source hotel search via PMS API
- **Rate Comparison Agent (4.4):** Compare rates across sources
- **Hotel Booking Agent (4.5):** Book via PMS API using OTAIP agent loop
- **Revenue Optimization Agent:** AI-driven pricing recommendations via PMS rate API
- **Guest Communication Agent:** Automated pre-arrival, in-stay, post-stay messaging
- **Housekeeping Optimization Agent:** AI room assignment and scheduling

**Deliverables:** OTAIP agents running on the PMS. An AI agent can search, compare, book, and manage hotel stays through the same OTAIP infrastructure as air.

**Estimate:** 4 sessions × 4 hours = ~16 hours Claude Code time

---

### Phase 8 — Admin UI (Week 13-16)
**4-5 Claude Code sessions**

What gets built:
- **React admin dashboard** (Telivity-branded)
- Screens: Property setup, Room management, Reservations, Guest profiles, Folios, Rates, Housekeeping dashboard, Night audit, Reports, Channel manager config
- **Mobile-responsive** front desk view
- **Real-time updates** via WebSocket for room status, new bookings

**Deliverables:** Usable admin interface. A hotel can actually operate on this system.


---


### What This Means in Real Time

- Claude Code sessions average 3-4 hours each
- At 1-2 sessions per day: **3-4 months** of consistent work
- At 1 session per day with breaks: **4-5 months** realistically
- Your time (domain input, reviews, direction): ~30 min/day average, heavier during Phase 1 and 7
- Biggest variable: Phase 6 (channel manager) depends on API access and partner relationships

### MVP Milestone (Phase 0-5): ~9 weeks

A standalone PMS that works for a single property. No OTA distribution yet, no AI agents, no UI — but the entire backend works. A hotel could operate on it via API.

### Competitive Milestone (Phase 0-7): ~13 weeks

PMS + channel manager + OTAIP agents. Now it's a real product. Hotels can get booked via OTAs, and AI agents can manage operations. This is where it gets interesting commercially.

---

## WHAT'S NOT IN THIS PLAN (FUTURE)

- Multi-property / portfolio management (Phase 9)
- Revenue management system integration (IDeaS/Duetto)
- Door lock integration (ASSA ABLOY, Salto)
- POS integration (MICROS, Toast)
- Accounting/ERP integration (QuickBooks, Xero)
- Guest mobile app / kiosk check-in
- Group bookings / allotments / attrition (meetings & events vertical)
- GDS distribution (Sabre/Amadeus hotel segments)
- Loyalty program engine
- Advanced reporting / BI dashboard

---

## DECISIONS LOCKED (April 5, 2026)

| Decision | Answer | Source |
|----------|--------|--------|
| Agents in PMS or on PMS? | **On PMS via API** (Option B) | confirmed |
| Target market | **General — fork it, it's yours** | confirmed |
| MVP scope | **Multi-property** (STR operators need this) | confirmed |
| Repo | **Separate repo** from OTAIP | Recommended, confirmed |
| Name | **HAIP** (Hotel AI Platform) | confirmed |
| Domain questions | **Research agents found answers** | 12/12 answered |

## RESEARCH-INFORMED ADJUSTMENTS TO BUILD PLAN

Based on 12 domain questions answered by research agents:

1. **GDS architecture from day one** — GDS hotel bookings growing 13.5%/year, not declining. Design for it in Phase 0 schema even if integration comes in Phase 6.
2. **Compliance is a Phase 0-1 concern, not Phase 8** — PCI tokenization (Stripe), GDPR basics, guest registration forms, and tax engine are absolute MVP blockers. No hotel will adopt without them.
3. **Night audit automation is table-stakes** — 82% of hoteliers expect this. Already in Phase 5, confirmed as MVP priority.
4. **Basic housekeeping in MVP** — Small hotels need it built-in. Specialist tools (Optii, Quore) connect via webhook later.
5. **RMS integration is post-MVP** — 84% use RMS but it's not needed to operate. Architect data exports now, integrate later.
6. **Door locks are post-MVP** — 70% adoption expected but hotels operate fine without it. Phase 1 roadmap item.
7. **STR is a separate product line** — Research says fundamentally different needs (channel sync, dynamic pricing, automation). Build hotel PMS core first, STR module later. **Confirmed by Dušan April 5.**
8. **Revenue management + channel distribution is existential** — Dušan: "that's where they live or die." RMS data feeds and channel distribution should be elevated to Phase 1-2 priority, not Phase 6 afterthought.
8. **Apaleo Agent Hub is still experimental** — 4 agents, no scaling data. Don't make agents the core selling point. PMS must stand alone.
9. **Community building is a moat** — No dominant open-source hotel tech community exists. "Hotel Tech Builders" Discord + weekly calls could differentiate.

## PHASE COMPLETION LOG

| Phase | Status | Date | Tests | Key Stats |
|-------|--------|------|-------|-----------|
| 0. Scaffolding | ✅ Complete | Apr 5 | 13 | Monorepo, schema, CI |
| 1. Reservations | ✅ Complete | Apr 5 | 73 | State machine, availability, rates |
| 2. Billing | ✅ Complete | Apr 5 | 73 | Folio, charges, Stripe tokenization |
| 3. Front Desk | ✅ Complete | Apr 6 | 122 | Check-in/out, express, groups |
| 4. Housekeeping | ✅ Complete | Apr 6 | 168 | Tasks, checklists, inspection flow |
| 5. Night Audit | ✅ Complete | Apr 6 | 197 | 12-step audit, reports, RevPAR/ADR |
| 6. Channel Manager | ✅ Complete | Apr 6 | 239 | ChannelAdapter, ARI push, rate parity |
| 7. OTAIP Agent Layer | ✅ Complete | Apr 6 | 281 | Connect API (16 endpoints), insights |
| 8. Admin UI | ⏳ Next | — | — | React dashboard |

**MVP Milestone (Phases 0-5): ✅ REACHED — Apr 6, 2026**
**Competitive Milestone (Phases 0-7): ✅ REACHED — Apr 6, 2026**

---

## ALL DECISIONS FINALIZED (April 5, 2026)

| Decision | Answer |
|----------|--------|
| Agents | On PMS via API (Option B) |
| Target | General-purpose, fork it |
| MVP scope | Multi-property |
| Repo | Separate from OTAIP |
| Name | HAIP |
| STR vs Hotel | Hotel core first, STR module later |
| Channel distribution | ChannelAdapter interface — ship SiteMinder/DerbySoft adapters first (instant 450+ OTA reach), direct OTA adapters over time (Booking.com, Expedia). Same pattern as OTAIP ConnectAdapter. |
| Revenue mgmt + distribution | Existential priority — elevated to Phase 1-2 |
| Dušan's PMS experience | Limited to SiteMinder and STR tools for now|
