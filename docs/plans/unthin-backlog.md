# Un-thin backlog — research-backed plan

**Status:** Defaults locked (2026-07-24). Implementation in
[#205](https://github.com/TelivityAI/haip/pull/205)
(`cursor/unthin-wave-a-ci1-aeea`). Do not invent further hotel operations beyond
confirmed KB + these locked MVP defaults.

**Separate track — remaining catalog integrations:** see
[integrations-planned-backlog.md](./integrations-planned-backlog.md) (**86**
registry `planned` rows for partner/cert / new-module work).

**Trigger:** These areas were previously marked “thin / partner-gated.” Six
parallel research passes + a HAIP code-anchor map produced the cut below.

**Related ship vehicle:** merge stack [#202](https://github.com/telivityai/haip/pull/202)
carried discrepancy *compute*, lost & found, service requests, SMS,
loyaltyNumber/VIP display, and four channel adapters. Un-thin execution extends
that stack.

---

## Grounding rules

1. Neutral API codes first; legacy labels (`Skip` / `Sleep`) as optional UI aliases.
2. Every table/route stays `propertyId`-scoped (HAIP multi-tenancy).
3. Partner-gated work (GDS host, Booking.com new-provider cert, Airbnb Preferred)
   is a **commercial** gate, not a “we don’t know the domain” gate.
4. Thick research notes live in gitignored `briefs/` on contributor machines —
   not in the public repo.

---

## Locked defaults (coding unblocked)

| Area | Locked MVP |
|------|------------|
| **A1 discrepancy** | Skip/Sleep as UI aliases for FO/HK mismatch codes; **no** sell hard-block; night audit **acknowledge** open cases (not hard stop) |
| **A2 items** | In-core L&F categories: `general \| baggage \| parcel \| valet` |
| **A3 folio inbound** | Amount-only; reject if room not in-house; `vendorTxnId` idempotency |
| **B1 turnaway** | Separate append-only entity; anonymous by default; manual desk |
| **B2 waitlist** | Separate **non-deduct** entity (not a reservation status); offer → convert |
| **C1 loyalty** | HAIP points bank; **org-scoped** program; txs attribute `propertyId`; award-points only (keep `vipLevel` manual); earn = nights × `pointsPerNight` on checkout (`delayDays` default **3**); burn = folio rebate |
| **C2 WhatsApp** | **Twilio** Content API (same vendor as SMS); reuse `gdprConsentMarketing` for marketing templates; transactional utility templates when guest has phone (no marketing needed); outbound only |
| **D1–D3** | Deep-link contract on booking engine; meta/GDS via existing CM adapters first; no SynXis SDK unless mandated |

---

## Slice map (build order)

### Wave A — Ops truth (code anchors already hot)

| ID | Topic | HAIP today (pre-#205) | Research-backed MVP | Locked |
|----|-------|----------------------|---------------------|--------|
| **A1** | Room discrepancy workflow | Compute-only `GET /rooms/discrepancies` | HK observation write + persisted cases + resolve/dismiss; Skip/Sleep aliases; night-audit acknowledge | Done in #205 |
| **A2** | Guest item tickets | Lost & found CRUD (90-day hold) | Extend L&F → baggage/parcel/valet | Done in #205 |
| **A3** | Folio inbound poster (PBX/minibar) | Charge types `phone`/`minibar`; thin `POST /pos/charges` | Property-scoped webhook → in-house folio + `vendorTxnId` | Done in #205 |

### Wave B — Demand capture

| ID | Topic | HAIP today (pre-#205) | Research-backed MVP | Locked |
|----|-------|----------------------|---------------------|--------|
| **B1** | Turnaway (denied / regret) | Absent | Append-only `turnaways` + reason codes; summary; anonymous default | Done in #205 |
| **B2** | Waitlist | Absent | Non-deduct `waitlist_entries` → offer → convert | Done in #205 |

### Wave C — Guest value & messaging

| ID | Topic | HAIP today (pre-#205) | Research-backed MVP | Locked |
|----|-------|----------------------|---------------------|--------|
| **C1** | Loyalty points ledger | `loyaltyNumber` + `vipLevel` display | Org program + award ledger; delayDays=3; folio rebate burn | Done in #205 |
| **C2** | WhatsApp channel | Email + SMS | Twilio `WhatsAppProvider`; outbound utility templates | Done in #205 |

### Wave D — Distribution depth

| ID | Topic | HAIP today (pre-#205) | Research-backed MVP | Locked |
|----|-------|----------------------|---------------------|--------|
| **D1** | Metasearch | Push `ChannelAdapter` only | Deep-link + CM meta products first | Docs + `buildBookingDeepLink` in #205 |
| **D2** | New OTAs | Booking.com, Expedia, SiteMinder, DerbySoft | Certify/activate existing first | Runbook in #205 |
| **D3** | GDS/CRS | `booking_source=gds` columns; no adapter | GDS via CM; no SynXis unless mandated | Runbook in #205 |

---

## Neutral discrepancy vocabulary

| Code | FO | HK | Legacy alias |
|------|----|----|--------------|
| `fo_occupied_hk_vacant` | Occupied | Vacant | Skip |
| `fo_vacant_hk_occupied` | Vacant | Occupied | Sleep |
| `person_count_mismatch` | Persons ≠ | Observed persons | Person |

FO occupancy stays derived from in-house assignment; HK writes **observation**, not FO status.

Track-It-class item tracking is **adjacent** (luggage/parcel/valet), not a synonym for discrepancy.

---

## Partner / cert walls (honest)

| Item | Wall |
|------|------|
| Booking.com new connectivity provider | Portal pausing new providers; hotels cannot call Connectivity APIs directly without partner/CM path |
| Expedia | System Provider in Partner Central |
| Agoda | Self-cert + pilot; OAuth mandatory end-2026 |
| Airbnb | Preferred Software Partner bar — not a sprint |
| Tripadvisor Instant Book / trivago FastConnect | Commercial alignment before build |
| Direct Amadeus/Sabre/Travelport **hotel sell** | Wrong layer for indie PMS — use CRS/CM |
| WhatsApp | Meta Cloud API or BSP; On-Prem dead; templates + opt-in required |

---

## Suggested sequencing (executed)

```text
A1 discrepancy workflow  →  A3 folio inbound poster  →  B1 turnaway  →  B2 waitlist
         ↘ A2 item tickets (after A1)
C2 WhatsApp templates (parallel; notifications adapter)
C1 loyalty ledger (after locked defaults above)
D1 deep links + CM meta  →  D2 certify existing OTAs  →  D3 GDS via CM
```

Implementation PR: [#205](https://github.com/TelivityAI/haip/pull/205).

---

## Former open questions → locked answers

### Discrepancy / items
- [x] Skip/Sleep labels as UI aliases (neutral codes in API)
- [x] No sell-block on open sleep
- [x] Night audit: acknowledge (not hard stop)
- [x] Item tickets in HAIP core (L&F categories)

### Demand capture
- [x] Waitlist as separate entity
- [x] Non-deduct waitlist confirmed
- [x] Turnaway PII: anonymous by default

### Loyalty
- [x] Points bank in HAIP
- [x] Org-scoped program
- [x] Earn: nights × pointsPerNight; delayDays=3
- [x] Burn MVP: folio rebate

### WhatsApp
- [x] Twilio Content API
- [x] Reuse `gdprConsentMarketing` for marketing; transactional without marketing consent

### Distribution
- [x] Meta MVP: deep links + CM-operated campaigns
- [x] GDS via CM (no SynXis SDK in MVP)
- [ ] Next direct OTA / connectivity provider status — commercial, not blocking MVP

---

## Code anchors (extension points)

| Area | Module |
|------|--------|
| Discrepancy | `apps/api/src/modules/room/room-discrepancy.service.ts` |
| L&F / items | `apps/api/src/modules/lost-and-found/` |
| Folio inbound | `apps/api/src/modules/folio-inbound/` |
| Turnaways / waitlist | `modules/turnaways/`, `modules/waitlist/` |
| Folio / POS | `folio.service.ts`, `modules/pos/` |
| SMS → WhatsApp | `modules/notifications/` |
| Loyalty ledger | `modules/loyalty/` |
| Channels | `modules/channel/` + `ChannelAdapter` |
| Booking engine deep links | `modules/booking-engine/deep-link.ts` |
| Distro runbooks | `docs/channels/{metasearch,ota-certification,gds-cm,whatsapp}.md` |

---

## Research sources (public)

- Opera Cloud room discrepancies, turnaways, waitlist, Track It (docs.oracle.com)
- protel Air / RoomKey discrepancy help
- Apaleo / Mews / Cloudbeds housekeeping & webhook docs
- Meta WhatsApp Cloud API opt-in & template rules
- Oracle FIAS IFC specs; OHIP charge posting
- Google Hotel Prices feeds / ARI; Tripadvisor Instant Booking; trivago FastConnect
- SynXis HTNG availability/reservation sync; Agoda supply certification

Full contributor notes (tables, API sketches, URL indexes) are kept in local
`briefs/*-research.md` and must not be treated as committed KB truth.
