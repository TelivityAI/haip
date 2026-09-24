# OTAIP Lodging Agent Taxonomy — Domain 4

> Open source agents for the hotel booking lifecycle. Generic hotel infrastructure usable by any developer, airline, or TMC.
> TMC-specific hotel operations (negotiated rate management, commission reconciliation, attachment optimization) are in TMCAP, NOT here.

**Domain principle:** Mirror the air domain pattern (Search → Evaluate → Price → Book → Manage) adapted for hotel-specific realities.

**Knowledge base:** `OTAIP_LODGING_KNOWLEDGE_BASE.md` (v2, 12 sections)

---

## Domain 4: LODGING

### Agent 4.1 — Hotel Search Aggregator
**Status:** [NEEDS SPEC]
**Version:** 0.1.0
**Domain input required:** Yes — search parameters, source priority

**Purpose:** Multi-source hotel availability search across GDS hotel segments, direct APIs (Amadeus Hotel, Hotelbeds, Duffel Stays), and channel manager feeds. Returns raw, unmerged results from all connected sources.

**Why it exists:** Hotel inventory is fragmented across dozens of sources with no single system of record. Unlike air (GDS stores schedules), hotel GDS pulls real-time from CRS/PMS. Each source has different content quality, pricing, and availability. This agent abstracts the multi-source complexity.

**Inputs:**
- Location (city, coordinates, address, airport code)
- Check-in / check-out dates
- Room requirements (count, guests, bed type preferences)
- Rate type filter (BAR, corporate, consortium, government)
- Source priority / inclusion list
- Chain preference (if any)

**Outputs:**
- Raw hotel results from each connected source (NOT deduplicated)
- Per-result metadata: source, source property ID, response latency, content completeness score
- Source availability status (which APIs responded, which timed out)

**Downstream:** Feeds Agent 4.2 (Property Deduplication) and Agent 4.4 (Rate Comparison)

**Key design decisions:**
- Does NOT deduplicate — that's Agent 4.2's job
- Parallel async calls to all sources with configurable timeout per source
- Returns partial results if some sources timeout (don't block on slowest source)
- Must handle rate limiting per API (Hotelbeds: 50 req/day on eval tier)
- Soft hold / session management for sources that support it

**Adapters needed:**
- Amadeus Hotel Search API
- Hotelbeds API (APItude)
- Duffel Stays API
- GDS hotel segment query (Sabre, Amadeus, Travelport)
- Future: Google Hotel API (gated), Expedia Rapid (gated)

---

### Agent 4.2 — Property Deduplication Agent
**Status:** [NEEDS SPEC]
**Version:** 0.1.0
**Domain input required:** Yes — matching thresholds, source trust hierarchy

**Purpose:** Takes raw multi-source hotel results from Agent 4.1 and identifies duplicate properties, merging them into canonical property records with the best content from each source.

**Why it exists:** This is THE biggest content quality problem in hotel distribution. 40-60%+ of results in a multi-source city search are duplicates of the same physical property listed under different names, IDs, coordinates, and content. Without deduplication, search results are unusable noise.

**Inputs:**
- Raw hotel results from Agent 4.1 (multiple sources, unmerged)
- Shortlist / blocking configuration (similarity only proposes candidates)
- Source trust hierarchy (which source has best photos, most accurate coordinates, etc.)

**Outputs:**
- Canonical property records (one per physical property) for **same** decisions
- Per-property: merged content (best name, best address, best coordinates, best photos, merged amenities)
- Per-pair outcome: same / maybe / different, with field-level disagreement notes on maybe
- Source attribution (which data came from which source)
- Maybe pairs flagged for human review (not auto-merged)

**Matching pipeline:**
1. **Normalize** — standardize address components, strip noise words ("Hotel", "The", "Resort & Spa"), normalize chain names
2. **Block** — group candidates by coarse criteria (city + chain code) to reduce O(n²) comparison space
3. **Shortlist** — multi-algorithm similarity scoring (proposes candidates only):
   - Jaro-Winkler on property name (weight: 0.3)
   - Levenshtein on normalized address (weight: 0.2)
   - Haversine distance on coordinates, 250m threshold (weight: 0.25)
   - Chain code exact match (weight: 0.15)
   - Star rating match (weight: 0.1)
4. **Decide** — for each shortlisted pair, outcome is **same** (merge) / **maybe** (human review, with which fields disagree) / **different** (leave apart). Cheap similarity scores only propose candidates; they are **not** merge authority. Do not auto-merge solely because a composite exceeds 0.85.
5. **Merge** — combine best content per attribute using source trust hierarchy — **same** pairs only

**Content merge hierarchy (default):**
1. Hotel direct / chain CRS (most authoritative)
2. Booking.com / Expedia (strong content quality)
3. GDS content (standardized but sparse)
4. Smaller aggregators

**External mapping integration:**
- GIATA Multicodes (if licensed — 1.2M properties, 99.99% precision)
- Vervotech API (SaaS alternative)
- Gimmonix Mapping.Works (fully automated)
- OpenStreetMap / Overture Maps (free, supplementary)

**Key design decisions:**
- Should run as BOTH background pipeline (pre-cache canonical properties for known cities) AND real-time at search time (for new/uncached results)
- Background mode: nightly content refresh from all sources, build canonical property database
- Real-time mode: fast-path matching against cached canonical records, with fallback to full pipeline for unknown properties
- Must be explainable — every merge decision has a confidence score and reasoning trail
- Unmatched properties are returned as-is, not silently dropped

**GDS property code cross-reference:**
- Amadeus property code ≠ Sabre property code ≠ Galileo property code
- Over 200 chain codes in Sabre alone
- No centralized public registry — this agent builds and maintains its own mapping table

---

### Agent 4.3 — Hotel Content Normalization Agent
**Status:** [NEEDS SPEC]
**Version:** 0.1.0
**Domain input required:** Yes — room type taxonomy, amenity taxonomy

**Purpose:** Standardizes hotel content (room types, amenity names, descriptions, photos) into a consistent taxonomy so downstream agents and UIs can display and compare properties uniformly.

**Why it exists:** Hotels have no universal room type codes (unlike airline cabin classes). "Superior King" at one property might be "Deluxe King Room" at another and "KNG DLX" in the GDS. Amenities are equally chaotic — "complimentary WiFi", "free internet", "wireless included" all mean the same thing. Without normalization, comparison and filtering are impossible.

**Inputs:**
- Canonical property records from Agent 4.2
- Raw room type codes and descriptions per source
- Raw amenity lists per source
- Photos with metadata

**Outputs:**
- Standardized room type classification (mapped to OTAIP room taxonomy)
- Standardized amenity set (mapped to OTAIP amenity taxonomy)
- Normalized descriptions (consistent format, key facts extracted)
- Photo quality scoring and categorization (exterior, room, bathroom, lobby, pool, etc.)

**Room type normalization:**
- Map GDS codes (SGL, DBL, TWIN, STE, etc.) + free-text descriptions to OTAIP taxonomy
- Extract: bed type, bed count, room category (standard/superior/deluxe/suite), view type, accessibility features
- Handle chain-specific naming conventions (Marriott vs Hilton vs IHG naming patterns)

**Amenity normalization:**
- Map to standardized categories: connectivity, food & beverage, fitness, pool, parking, accessibility, business, pets, sustainability
- Boolean + detail: not just "has pool" but "outdoor heated pool, seasonal"
- Source: prefer hotel direct for amenity accuracy

**Key design decisions:**
- Taxonomy is OTAIP-defined and open source — not locked to any vendor's taxonomy
- Must handle multi-language content (hotel descriptions in local language + English)
- Photo deduplication (same photo from multiple sources)
- NLP-based extraction from free-text descriptions where structured data is missing

---

### Agent 4.4 — Hotel Rate Comparison Agent
**Status:** [NEEDS SPEC]
**Version:** 0.1.0
**Domain input required:** Yes — rate parity rules, rate type classification

**Purpose:** Compares rates for the same canonical property across all sources, identifies best available rate per rate type, detects rate parity violations, and presents pricing transparently.

**Why it exists:** The same room at the same hotel can show different prices across Amadeus, Hotelbeds, Duffel, and OTAs. Rate parity is supposed to prevent this but enforcement is shifting from contractual to algorithmic (EU Digital Markets Act banned explicit parity clauses in 2024). TMCs and travelers need to see the full price picture.

**Inputs:**
- Canonical property records from Agent 4.2 (with source attribution)
- Rate details per source (base rate, taxes, fees, cancellation policy)
- Rate type classification (BAR, corporate, consortium, opaque, package, government, AAA)
- Traveler eligibility (loyalty tier, corporate program, government status)

**Outputs:**
- Best rate per rate type for each canonical property
- Total cost breakdown: base rate + taxes + resort fees + mandatory fees (the REAL price)
- Rate parity analysis (flag where same room type shows different prices across sources)
- Cancellation policy comparison per rate
- Value score: price-to-amenity ratio

**Key design decisions:**
- Must include ALL mandatory fees in total (resort fees, facility fees, destination fees often excluded from advertised rate)
- Rate fencing awareness: non-refundable vs flexible, advance purchase vs standard, member-only vs public
- Currency normalization for international properties
- Rate freshness indicator (how old is this quote — hotel rates change faster than you think)

---

### Agent 4.5 — Hotel Booking Agent
**Status:** [NEEDS SPEC]
**Version:** 0.1.0
**Domain input required:** Yes — payment flow, confirmation code handling

**Purpose:** Executes hotel bookings through the optimal source, manages the full booking flow from rate verification through confirmation, and handles the three-layer confirmation code reality.

**Why it exists:** Hotel booking isn't just "send a request, get a confirmation." There are soft holds during checkout, real-time inventory that changes between search and book, three separate confirmation codes (CRS, PMS, channel), and different payment models (prepaid, pay-at-property, virtual card) that each have different flows.

**Inputs:**
- Selected property + room + rate (from Agent 4.4)
- Guest details (name, contact, loyalty numbers, special requests)
- Payment method (prepaid, pay-at-property, virtual card details)
- Booking source (which API to book through — may differ from search source)

**Outputs:**
- Booking confirmation with all confirmation codes:
  - CRS confirmation number
  - PMS confirmation number (when available — may arrive async)
  - Channel confirmation number
- Payment status (charged, authorized, pending)
- Cancellation policy attached to THIS specific booking
- Cancellation deadline (exact datetime)

**Booking flow:**
1. Rate re-verification (price may have changed since search)
2. Soft hold initiation (if source supports it)
3. Guest details submission
4. Payment processing per method:
   - Prepaid: charge immediately, VCN activates on booking date for non-refundable
   - Pay-at-property: credit card guarantee only, no charge
   - Virtual card: generate single-use VCN, restrict to room + tax + resort fees
5. Booking confirmation receipt
6. Cross-reference all confirmation codes
7. Confirmation delivery to guest

**Key design decisions:**
- Must handle booking failures gracefully (rate changed, sold out between search and book)
- Retry on different source if primary source fails (same property may be bookable via Amadeus when Hotelbeds fails)
- Dual folio setup for virtual card bookings (Folio 1: VCN for room charges, Folio 2: guest card for incidentals)
- PMS confirmation may arrive asynchronously — agent must poll or listen for webhook

---

### Agent 4.6 — Hotel Modification & Cancellation Agent
**Status:** [NEEDS SPEC]
**Version:** 0.1.0
**Domain input required:** Yes — modification rules, cancellation penalty logic

**Purpose:** Handles post-booking changes including modifications (name, bed type, special requests), date changes (which are cancel/rebook, NOT modifications), and cancellations with penalty calculation.

**Why it exists:** Hotel modifications are fundamentally different from air. Simple attribute changes (guest name, bed type, smoking preference, accessibility needs) are freely modifiable. But date changes require full cancel-and-rebook because new dates = new rates and new policies. The agent must know the difference and route accordingly.

**Inputs:**
- Existing booking reference (all confirmation codes)
- Requested change type and details
- Current cancellation policy and deadline

**Outputs:**
- For modifications: updated booking confirmation
- For date changes: cancellation confirmation + new booking confirmation + cost difference
- For cancellations: cancellation confirmation + penalty amount (if any) + refund details
- Deadline warnings: how close to penalty window

**Modification classification:**
- **Free modifications** (no cancel/rebook): guest name, bed type, smoking preference, special requests, accessibility needs, number of guests, add/remove amenities
- **Cancel/rebook required** (new rates apply): check-in date change, check-out date change, room type upgrade/downgrade, property change
- **Not modifiable**: non-refundable bookings (cancel only, no refund)

**Cancellation logic:**
- Check against cancellation deadline (24hr / 48hr / 72hr before arrival)
- Calculate penalty: percentage of total OR per-night charge
- Handle stepped penalties (more restrictive closer to arrival)
- California law: free cancellation within 24 hours of booking regardless of policy
- Non-refundable: full charge, no exceptions (except California 24hr)

**Key design decisions:**
- Always check cancellation deadline before processing ANY change
- For date changes: quote the new booking first, get guest confirmation, THEN cancel old + book new
- Must handle partial stay cancellations (shorten stay by removing nights)
- No-show handling: if guest doesn't check in, different from cancellation (typically 1-night charge)

---

### Agent 4.7 — Hotel Confirmation Verification Agent
**Status:** [NEEDS SPEC]
**Version:** 0.1.0
**Domain input required:** Yes — verification workflow, escalation rules

**Purpose:** Verifies that hotel bookings actually landed in the property's PMS, cross-checks all three confirmation code layers, and catches booking failures that happen silently between CRS and PMS.

**Why it exists:** A CRS confirmation doesn't guarantee the reservation reached the hotel's PMS. Bookings can fail silently in the CRS→PMS sync, especially for independent hotels or properties using older PMS systems. A traveler shows up with a confirmation number and the hotel has no record. This agent catches that before the guest arrives.

**Inputs:**
- Booking confirmation codes (CRS, channel, PMS if available)
- Booking source and property details
- Check-in date (determines verification urgency)

**Outputs:**
- Verification status: confirmed / unconfirmed / discrepancy detected
- PMS confirmation code (if not received at booking time)
- Discrepancy details (rate mismatch, room type mismatch, dates mismatch)
- Escalation flag if verification fails

**Verification workflow:**
1. Check if PMS confirmation code was received at booking time
2. If not: poll PMS (via hotel API or channel manager) for reservation sync status
3. Cross-check: CRS rate vs PMS rate, CRS room type vs PMS room type, CRS dates vs PMS dates
4. Flag any discrepancies for human review
5. Escalate unverifiable bookings before check-in date

**Key design decisions:**
- Verification timing: run 24-48 hours after booking, then again 24 hours before check-in
- Not all properties expose PMS status via API — for those, verification is best-effort
- Must handle the reality that some hotels are slow to sync (especially independents)
- Walking/overbooking detection: if PMS shows "waitlist" or "tentative" status, escalate immediately

---

## Domain 4 Agent Interaction Map

```
Guest Request: "Find me a hotel in Chicago for March 10-12"
    │
    ▼
Agent 4.1 (Search Aggregator)
    │ Raw results from Amadeus + Hotelbeds + Duffel + GDS
    │
    ▼
Agent 4.2 (Property Deduplication)
    │ Canonical properties (duplicates merged)
    │
    ▼
Agent 4.3 (Content Normalization)
    │ Standardized room types, amenities, photos
    │
    ▼
Agent 4.4 (Rate Comparison)
    │ Best rate per property, total cost with fees, parity analysis
    │
    ▼
Guest Selects Property + Room + Rate
    │
    ▼
Agent 4.5 (Booking)
    │ Confirmation codes, payment processed
    │
    ▼
Agent 4.7 (Confirmation Verification)
    │ PMS sync verified, discrepancies caught
    │
    ▼
[Post-Booking Changes]
    │
    ▼
Agent 4.6 (Modification / Cancellation)
    │ Free mod vs cancel/rebook routing
```

---

## Cross-Domain Integration Points

| OTAIP Agent | Lodging Integration |
|-------------|-------------------|
| Agent 1.1 (Air Search) | Trip context: hotel search triggered by air booking destination + dates |
| Agent 8.2 (Policy Validation) | Hotel policy compliance: is this property within per diem? approved chain? |
| Agent 8.5 (Duty of Care) | Hotel location feeds traveler tracking for safety/security |
| Future: Agent 5.x (Ground Transport) | Airport-to-hotel transfer booking |

## TMCAP Premium Agents (NOT in OTAIP)

The following hotel agents belong in the Telivity TMCAP premium taxonomy:
- **Hotel Program Agent** — negotiated corporate rates, consortium rates, LRA enforcement, RFP management
- **Commission Reconciliation Agent** — track and verify hotel commission payments to TMC
- **Hotel Attachment Agent** — identify air bookings missing hotel, drive attachment rates up

These are TMC-specific revenue/operations agents that add proprietary value on top of the open source booking lifecycle.
