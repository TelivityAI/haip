# Un-thin backlog — research-backed plan

**Status:** Research synthesis (2026-07-24). **Not domain law** until the KB owner
confirms open questions and lands definitions in the private knowledge base.
Do not invent hotel operations beyond confirmed KB + this research.

**Trigger:** These areas were previously marked “thin / partner-gated.” Six
parallel research passes + a HAIP code-anchor map produced the cut below.

**Related ship vehicle:** merge stack [#202](https://github.com/telivityai/haip/pull/202)
already carries discrepancy *compute*, lost & found, service requests, SMS,
loyaltyNumber/VIP display, and four channel adapters.

---

## Grounding rules

1. Neutral API codes first; legacy labels (`Skip` / `Sleep`) as optional UI aliases.
2. Every table/route stays `propertyId`-scoped (HAIP multi-tenancy).
3. Partner-gated work (GDS host, Booking.com new-provider cert, Airbnb Preferred)
   is a **commercial** gate, not a “we don’t know the domain” gate.
4. Thick research notes live in gitignored `briefs/` on contributor machines —
   not in the public repo.

---

## Slice map (build order)

### Wave A — Ops truth (code anchors already hot)

| ID | Topic | HAIP today | Research-backed MVP | Owner must confirm |
|----|-------|------------|---------------------|--------------------|
| **A1** | Room discrepancy workflow | Compute-only `GET /rooms/discrepancies` (`occupied_without_reservation` / `vacant_with_in_house_reservation`) | HK observation write + persisted cases + resolve via check-in/out / correct observation / dismiss+note; optional `person_count_mismatch`; night-audit checklist hook | Skip/Sleep UI labels? Hard-block sell on “sleep”? Night-audit hard stop? |
| **A2** | Guest item tickets (Track-It-class) | Lost & found CRUD (90-day hold) | Extend L&F → baggage/parcel/valet tickets linked to reservation + optional discrepancy | In-core vs integrate Quore/ALICE later? |
| **A3** | Folio inbound poster (PBX/minibar) | Charge types `phone`/`minibar`; `FolioService.postCharge`; thin `POST /pos/charges` | Signed property-scoped webhook: roomNumber → in-house folio → idempotent `vendorTxnId` post | Amount-only vs article master? Post-after-checkout policy? |

### Wave B — Demand capture

| ID | Topic | HAIP today | Research-backed MVP | Owner must confirm |
|----|-------|------------|---------------------|--------------------|
| **B1** | Turnaway (denied / regret) | Absent | Append-only `turnaways` + reason codes (`denial`\|`regret`); summary report; default **anonymous** | Manual desk only vs IBE/channel auto-denial firehose? |
| **B2** | Waitlist | Absent (status machine has no waitlist) | Separate **non-deduct** `waitlist_entries` → offer → convert (re-check availability → real reservation) | Reservation status vs separate entity? Notify-all vs sequential TTL offers? |

### Wave C — Guest value & messaging

| ID | Topic | HAIP today | Research-backed MVP | Owner must confirm |
|----|-------|------------|---------------------|--------------------|
| **C1** | Loyalty points ledger | `loyaltyNumber` + `vipLevel` display only | Org-scoped program + account; award-points ledger (earn/burn/adjust); delay-days accrual; one burn path (folio rebate **or** free night); webhooks | HAIP as points bank vs external stub? Org vs property program? Award-only vs award+tier day one? |
| **C2** | WhatsApp channel | Email + SMS (`NotificationService` / Twilio) | `WhatsAppProvider` sibling of SMS; **outbound utility templates only**; property WABA config + template map | Twilio vs 360dialog vs direct Cloud API? Explicit `whatsappOptIn` vs reuse marketing consent? |

### Wave D — Distribution depth

| ID | Topic | HAIP today | Research-backed MVP | Owner must confirm |
|----|-------|------------|---------------------|--------------------|
| **D1** | Metasearch | Push `ChannelAdapter` only; booking engine exists | Deep-link contract for direct engine; meta via SiteMinder/DerbySoft products first; then Google Hotel Prices (pull/ARI) if HAIP is the partner | Own Google Hotel Center vs CM-operated campaigns? Who pays CPC? |
| **D2** | New OTAs | Booking.com, Expedia EQC, SiteMinder, DerbySoft | Certify/activate existing first; next direct OTA only if open partner program (e.g. Agoda) — else CM | Is HAIP already a Booking/Expedia connectivity provider? Markets first? |
| **D3** | GDS/CRS | `booking_source=gds` + GDS code columns; **no adapter** | GDS via CM channel first; SynXis/HTNG CRS adapter only if corporate segment mandates | GDS in next slice or post? SynXis relationship? |

---

## Neutral discrepancy vocabulary (proposed)

| Code | FO | HK | Legacy alias |
|------|----|----|--------------|
| `fo_occupied_hk_vacant` | Occupied | Vacant | Skip |
| `fo_vacant_hk_occupied` | Vacant | Occupied | Sleep |
| `person_count_mismatch` | Persons ≠ | Observed persons | Person |

FO occupancy stays derived from in-house assignment; HK writes **observation**, not FO status. Resolve orchestrates existing reservation check-in/out APIs.

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

## Suggested sequencing

```text
A1 discrepancy workflow  →  A3 folio inbound poster  →  B1 turnaway  →  B2 waitlist
         ↘ A2 item tickets (after A1)
C2 WhatsApp templates (parallel; notifications adapter)
C1 loyalty ledger (after owner answers §loyalty questions — do not invent earn rules)
D1 deep links + CM meta  →  D2 certify existing OTAs  →  D3 GDS via CM
```

---

## Open question checklist (block coding until answered)

### Discrepancy / items
- [ ] Skip/Sleep labels in UI vs descriptive codes only?
- [ ] Sell-block on open `fo_vacant_hk_occupied`?
- [ ] Night audit: hard stop vs acknowledge exceptions?
- [ ] Item tickets in HAIP core vs external HK ops tool?

### Demand capture
- [ ] Waitlist as reservation status or separate entity?
- [ ] Non-deduct waitlist confirmed?
- [ ] Turnaway PII: anonymous by default?

### Loyalty
- [ ] Points bank in HAIP vs external?
- [ ] Org-scoped program?
- [ ] Earn basis + qualifying rates + accrual delay?
- [ ] Burn MVP path?

### WhatsApp
- [ ] BSP / direct Cloud API choice?
- [ ] Opt-in field model?

### Distribution
- [ ] Next direct OTA list?
- [ ] Connectivity provider status for Booking/Expedia?
- [ ] Meta MVP: owned Google vs CM?
- [ ] GDS now or post?

---

## Code anchors (extension points)

| Area | Module |
|------|--------|
| Discrepancy | `apps/api/src/modules/room/room-discrepancy.service.ts` |
| L&F / items | `apps/api/src/modules/lost-and-found/` |
| Service requests | `apps/api/src/modules/service-requests/` |
| Folio / POS | `folio.service.ts`, `modules/pos/` |
| SMS → WhatsApp | `modules/notifications/` |
| Loyalty profile | `modules/guest/` → future `modules/loyalty/` |
| Channels | `modules/channel/` + `ChannelAdapter` |
| Booking engine deep links | `modules/booking-engine/` |

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
