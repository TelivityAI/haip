# Task 12 report — audited accepted-stay amendments

## Outcome

Implemented a staff-only, property-scoped Modify Stay workflow for reservations linked to accepted Booking Requests. The original request dates, submitted/current quote snapshots, accepted price, decision, and accepted links remain immutable evidence; the linked reservation and folio are the operational records that change.

- Added preview and commit endpoints with `reservations.read` / `reservations.write` permissions, canonical dates, full-window availability, an opaque reservation/quote fingerprint, and prior/current/custom price choices.
- Added a durable amendment row containing property/request/reservation/folio ownership, idempotency key, operation fingerprint, old/new dates and totals, full old/new pricing snapshots, custom reason, actor, and completion identity.
- The commit transaction locks property, request, reservation, and room-type inventory in that order, recomputes the authoritative quote under the locks while excluding the existing reservation, rejects stale previews, and serializes concurrent retries.
- Added the current operational reservation to accepted request detail and retained the request's original accepted deal alongside it in Overview and Payments & plan.
- Added an accessible Modify Stay modal with a compact old-to-new stay rail, all three price choices, exact currency-aware custom-money validation, required custom reason, duplicate-submit protection, conflict refetch without draft loss, and complete request/reservation/availability/folio/payment/audit invalidation.
- Added complete translations for the new workflow in English, German, Spanish, French, Croatian, Italian, Brazilian Portuguese, and Serbian Latin.

## Pricing and posting contract

Prior-basis pricing is derived only from the reservation's immutable operational pricing snapshot. Overlapping nights keep their exact accepted room/tax lines; extensions copy the nearest accepted boundary; per-night services follow the same rule. Once/included services and the explicit accepted-price adjustment keep their amounts and original in-window dates, reanchoring to the new arrival only when their old date was removed. Deferred accepted-service posting now uses that immutable line date as well.

Current pricing normalizes the authoritative complete-stay quote. Custom pricing uses that quote as its line basis, requires a positive total and reason, and enforces the selected currency's exact minor-unit precision within the two-decimal ledger limit. The preview fingerprint covers the reservation timestamp, previous dates/total/pricing, proposed dates, and the complete current quote rather than only a displayed total.

Night audit now gives accepted room groups a stable `accepted-pricing:reservation:<reservationId>:night:<date>` identity. It claims that exact key atomically; unrelated manual room charges no longer suppress the canonical group, and a replay reports no new revenue. Amendment reconciliation touches only accepted-pricing groups owned by the target reservation:

- room/service base, tax, and explicit custom-adjustment components are reconciled independently;
- increases and decreases retain the original room/service/tax category instead of collapsing gross changes into a zero-tax generic adjustment;
- service charge-type changes offset the prior category and post the chosen category, preserving department routing;
- removed and repriced groups receive linked signed component corrections, including locked historical groups, without touching unrelated extras; canonical reversals remain reserved for exact staff reversal flows;
- newly added dates at or before the property's completed/locked audit boundary post immediately under the canonical source key, while future groups remain deferred;
- once/per-night service-rule transitions use the chosen accepted snapshot for posting rule, category, currency, amount, tax, and date range (including extensions beyond stale operational service dates); partially posted per-night groups can become one immediate once group without double revenue;
- accepted automatic services without a linked operational reservation-service row reject before reservation mutation;
- unrelated folio extras, payments, and accepted services from another reservation remain untouched;
- the folio must be open, in the same property and currency, and linked to the amended reservation.

The generic reservation modification route still cannot change accepted operational pricing. The amendment-only reservation seam requires the caller's transaction and locked reservation, validates complete snapshot coverage, returns audit-ready old/new state, and preserves the existing controller response shape.

## Audit, outbox, and retry safety

One committed operation creates one immutable amendment row, one actor-bearing request-linked reservation audit entry, and one durable `reservation.modified` consequence in the same transaction. The consequence is explicitly dispatch-only so it cannot create a second request audit. The single audit exposes complete old/new dates, totals, price sources, and reason. Best-effort delivery happens only after commit; retries recover the durable consequence and send no email. Same-key/same-fingerprint replays return the original result without another timeline entry, while key reuse with a different operation conflicts. Property-level serialization plus database uniqueness closes concurrent duplicate effects.

The request audit timeline accepts reservation rows only when they carry the Booking Request relationship, so unrelated check-in or generic reservation edits are not mislabeled as stay amendments. Audit details expose only the amendment ID, complete prior/current amendment values, price source, and reason.

## Migration and live PostgreSQL evidence

Migration `0029_booking_request_stay_amendments.sql`, Drizzle schema, and push schema add the amendment table, exact check constraints, property-scoped unique indexes, and composite same-property foreign keys for request, reservation, and folio. Supporting `(property_id, id)` unique indexes were added to reservations and folios.

An isolated PostgreSQL 16 database was created on `127.0.0.1:55433` because the existing host service on 5432 did not accept the repository's development credentials. Verification completed as follows:

- fresh push/migration succeeded, and immediate replay succeeded;
- seed succeeded;
- push replay after the final index-name adjustment succeeded twice;
- standalone migration 0029 executed twice through `psql` without failure;
- live catalog inspection confirmed the price-source, date, positive-total, custom-reason, and three ownership constraints plus both uniqueness boundaries;
- a behavioral backfill fixture gave the stable source key to one exact canonical room/date/amount row while leaving the duplicate candidate, a manual correction, and an amount mismatch unclaimed;
- the opt-in PostgreSQL money/audit contract passed 7/7.

The follow-up review repeated fresh push, immediate push replay, seed, standalone migration 0029 twice, and the opt-in 7-test PostgreSQL contract on PostgreSQL 16. The temporary container and seeded test data were removed after verification.

## Blocking review follow-up

The blocking review was reproduced and resolved with red/green coverage for:

1. the real preview query passing the global whitelist/forbid-non-whitelisted validation pipe with `propertyId` while the POST body remains unchanged;
2. snapshot-authoritative once/per-night and charge-type transitions, including already-posted rows, future exact lines, and removed services;
3. immediate canonical posting of missing groups on completed/locked business dates and replay safety;
4. manual room charges no longer suppressing accepted night groups, with source-key-winner accounting on replay;
5. removal of the duplicate generic consequence audit and complete actor-bearing old/new timeline data;
6. invalidation of the real `['reservations']` query family plus request, availability, folio, payment, and audit families;
7. separate room/service base and tax reconciliation for increase, decrease, removal, partial posting, category changes, and replay.

## Accepted-pricing mutex and additive-ledger follow-up

The second blocking review is resolved around one transaction-scoped PostgreSQL advisory mutex keyed by property and reservation. Accepted-stay amendment acquires it before the authoritative snapshot read. Accepted room-night, once-service, per-night-service, and service-cancellation paths acquire the same lock, re-read reservation/service state inside the same transaction, claim the stable source key there, and defer all folio/service webhooks until after commit. Both race orders are covered against PostgreSQL: a waiting poster sees the newly amended snapshot, while an already-committed old group is followed by an exact signed correction; neither order deadlocks or claims stale revenue after the amendment.

Migration `0030_booking_request_amendment_ledger.sql` and the matching Drizzle/push schema add immutable `charges.adjusts_charge_id` provenance. Stay repricing/removal is now represented only by signed, non-reversal component rows. Room/service base and tax stay separate; charge category, tax code/rate, parent group, affected service date, and adjusted component are retained. Repeated oscillations therefore remain additive reportable history (`100→80→100→70`, tax-only changes, and `100→120→removed`) instead of pretending a larger canonical reversal occurred.

Completed/locked audit dates are immutable. Their corrections post on the current open business date with the affected date in the description; a missing closed canonical group is recovered once on that open date under its stable source key, so audit replay cannot double revenue or mutate a closed summary. Once-service keys now include the operational service date. Moving the once date balances the old group and establishes a distinct new revision: closed revisions recover immediately and future revisions stay deferred.

Cancellation is authoritative to both scheduling and amendment pricing. The mutex-protected cancellation route is scoped to its reservation. Preview and commit lock/re-read linked reservation services, remove cancelled services from prior/current/custom operational bases and the fingerprint, and reject missing automatic-service links before mutating the reservation. Once and per-night posters re-check cancellation under the mutex and cannot resurrect a cancelled service or leave a ledger write behind after a failed state transition.

The isolated PostgreSQL 16 follow-up database on `127.0.0.1:55432` passed a fresh schema push, seed, push replay, standalone migration 0030 twice, catalog/FK checks, and the opt-in mutex race suite. The task-owned database container and the failed compose setup were removed after verification.

## Accepted-ledger operations review follow-up

The final blocking review is resolved with an explicit accepted-pricing group boundary. Canonical bases, their tax/custom children, and signed amendment corrections cannot be moved or transferred individually. Corrections cannot be reversed directly, and an accepted child directs the caller to reverse its canonical base. A base reversal locks the group and creates exact signed reversals for every immutable child, so `100,-20` becomes `-100,+20`; Daily Revenue uses the signed reversal sum and reports zero rather than `-40`. The dashboard applies the same eligibility rules to both reverse and move controls.

Duplicate `reservation_services` are matched deterministically per accepted snapshot component: the Booking Request-created `booking_engine` row wins, followed by creation time and ID for legacy rows. Only that row owns accepted once/per-night/closed-day groups. A cancelled accepted row remains authoritative even when an active front-desk duplicate exists, so the duplicate is neither charged nor allowed to reintroduce the service into an amended total.

The current open business date is now resolved from the property's IANA timezone and the latest completed audit boundary. Tests cover both sides of a UTC date boundary, a delayed audit, and no completed audit. Locked historical rows remain unchanged and corrections retain the affected service date in their descriptions. Removing a negative custom component links the positive correction to that exact immutable custom row.

Correction provenance is tenant-safe at the database layer. Drizzle, migration 0030, and push schema now use `(property_id, adjusts_charge_id) → charges(property_id, id)` backed by `charges_property_id_unique`; a preflight rejects legacy cross-property links before replacing the earlier single-column FK. Fresh/replay migration tests and live PostgreSQL verify both the catalog definition and a real cross-property insertion failure.

The live mutex suite now contains four PostgreSQL tests. In addition to both amendment/posting orders, it exercises the real public `AncillaryService` posting and cancellation seams in both race orders: cancellation-first makes the waiting poster re-read `cancelled` and write nothing, while posting-first commits `posted` and makes cancellation fail without deadlock. The narrow parameterized advisory-lock statement is documented in the hardening plan as the sole approved raw-SQL exception because Drizzle has no transaction-advisory-lock query primitive.

## TDD and review findings

In addition to the planned feature tests, independent diff review produced red/green regressions for:

1. repeated amendments recognizing the same earlier pricing delta twice;
2. a same-folio accepted service belonging to another reservation being eligible for reversal;
3. amendment source keys that were not reservation-scoped;
4. a same-property folio linked to a different reservation;
5. missing staff attribution on reconciliation charges;
6. missing durable same-property ownership constraints;
7. an over-broad legacy room-charge backfill;
8. custom price not appearing exactly in the proposed-stay rail;
9. custom-money errors not being programmatically connected to their input;
10. unrelated reservation audits being labeled as stay amendments;
11. one-time accepted services moving on an arrival extension even when their original date remained in the stay.

The final focused set covers schema/migration safety, pricing, transactional orchestration, reservation guards, availability exclusion, stable night posting, folio reconciliation, ancillary posting, dashboard behavior, and accessibility.

## Verification

| Check | Result |
| --- | --- |
| Focused database schema/migration tests | Pass: 22/22 |
| Focused Task 12 API tests | Pass: pricing, amendment, reservation, availability, night-audit, folio, and ancillary suites |
| Focused dashboard tests | Pass: Modify Stay modal plus Booking Requests page |
| Full monorepo test suite | Pass; shared 10/10, database 22/22, booking 44/44, dashboard 145/145, API 224 files / 1905 tests (12 intentional skips remain) |
| Final focused review set | Pass: API 134/134, database 18/18, dashboard 35/35 |
| Live PostgreSQL contract | Pass: final 4/4 mutex/service/FK contract, fresh push, seed, push replay, migration 0030 replay twice, and catalog checks |
| Repository typecheck | Pass |
| Repository lint | Pass: 0 errors; the repository's warning baseline remains (primarily explicit `any` and type-only imports) |
| Production build | Pass; the existing Vite large-chunk advisory remains |
| Eight-locale JSON/key parity | Pass |
| React Doctor changed-scope scan | 33 changed files scanned; the chained-iteration finding was fixed and the final scan reports no issues, score 63/100 |
| `git diff --check` | Pass |

## Design and scope

The frontend-design review kept the established Telivity typography, navy/teal/orange semantics, form controls, and modal behavior. The only subject-specific visual is the quiet old-to-new stay rail; every decorative icon is hidden from assistive technology and every state remains textual.

Task 12 only. No Task 13 work, push, pull request, automatic payment movement, guest-facing route, or email was added.
