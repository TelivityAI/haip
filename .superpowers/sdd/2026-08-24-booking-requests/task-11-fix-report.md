# Task 11 review-fix report — booking request operations workspace

## Outcome

Resolved the Task 11 review findings without changing Task 12.

- Property socket rooms recover after token refresh/reconnect. The dashboard leaves the previous property before joining the next, rejoins the active property on every socket `connect`, and cleans up its handler without duplication.
- Realtime invalidation consumes the actual `{ event, data, timestamp }` envelope and uses the authenticated active property room. Booking-request, payment, reservation, folio, audit, and guest-communication events invalidate every property-scoped booking-request workspace prefix; a known request ID also invalidates the exact request keys.
- The safe queue DTO exposes submitted/requested total and currency, with accepted total separate. Whitelisted server-side sorting runs before pagination (including numeric requested-total sorting), and the dashboard performs one list call rather than N+1 detail reads.
- Acceptance uses a property-scoped preview with submitted/current authoritative totals and an opaque versioned fingerprint. The locked acceptance transaction recomputes the quote and returns `409` before mutation when it changed; the modal refreshes the preview while preserving the draft.
- Denial stays blocked until the payment/resolution query succeeds. Loading, unknown, and failure states cannot be mistaken for zero money exposure.
- Audit history is read directly through an immutable `bookingRequestId` relationship, capped at 100 rows per page, and exposed through opaque keyset load-more pagination. Its cursor now carries the full-precision PostgreSQL epoch-microsecond value selected and compared in SQL, so rows inside one JavaScript millisecond cannot be skipped or duplicated. Current child IDs remain only as a backward-compatibility fallback, so deleted installment/allocation tombstones remain visible. The migration also propagates a missing tombstone relationship from sibling audit rows only when `(property, entity type, entity ID)` identifies exactly one request; conflicting histories remain unresolved. The allowlisted DTO includes safe summaries/actor display while removing processor tokens, claims, idempotency, consent, application answers, internal IDs, and provider secrets. A composite property/request/timeline index and guarded backfills support the bounded query.
- Payment availability and denial exposure are calculated by one canonical server ledger helper. Negative captured child movements reduce net once; movement-backed resolutions are provenance rather than a second subtraction; pending claims reserve capacity; movement-less returns and retained resolutions consume unresolved capacity. The safe DTO exposes net captured, allocated, reserved, available-to-allocate, available-to-resolve, unresolved, returned, and retained values, and the dashboard does not reconstruct them from gross movements.
- Payment movement provenance is derived server-side as `saved_card` or `external` from trusted origin data, never a user-entered provider label. The dashboard selects Refund versus External Return only from that discriminator.
- Legacy parent movements whose status is already `refunded` remain in the authoritative money summary and movement history. Zero-capacity parents expose no resolution action, while an inconsistent positive authoritative remainder uses that exact server value for the action default.
- Installment reorder is a single property/request-scoped bulk mutation. It locks the request and installment set, validates an exact unique ID set, writes contiguous order atomically, and records one audit event. Allocated installments permit order-only changes; rollback and concurrent calls are covered.
- All staff money fields validate canonical decimal strings without rounding, enforce currency precision (including JPY), reject zero/nonnumeric/excess precision, and preserve exact submitted text.
- Native dialog lifecycle, independent Accept/Deny versus payment actions, per-delivery retry pending state, keyboard reorder controls, permissions, and request-scoped query keys remain intact.
- All eight locale namespaces have key/placeholder parity and context-appropriate PMS vocabulary, with targeted German, Croatian, Italian, Serbian-Latin, French, Spanish, and Portuguese terminology regressions.
- Booking-request folio cache keys now include property, request, and accepted reservation scope. Every charge, external collection, refund, external return, and retention invalidates that workspace and the generic folio namespace, so an active accepted-request summary refreshes immediately without waiting for realtime.

## TDD evidence

Red/green cycles covered socket reconnect/property switching, reservation-ID-only realtime envelopes, audit tombstones and cursor pagination, queue list call count/server sorting, canonical child-return/pending/retain arithmetic, authoritative dashboard defaults and denial blocking, trusted provenance, atomic reorder rollback/concurrency, exact folio refresh, and locale terminology. The final cycle reproduced the millisecond-truncation failure with three differently ordered microsecond rows, the missing deleted-allocation relationship after its child row disappeared, both zero and positive-capacity legacy `refunded` parents, and the Portuguese/Serbian terminology regressions before the fixes. The audit migration-safety regression also enforces guarded UUID casts, a descending composite index, and conflict-safe sibling propagation in both migration paths.

## Verification

| Check | Result |
| --- | --- |
| Focused API booking-request suites | Pass: decision contract 47/47; PostgreSQL money/audit contract 7/7 |
| Focused dashboard booking-request suite | Pass: 24/24, including all 8 locale namespaces |
| Full API suite | Pass: 220 files / 1,844 tests; 2 files / 8 environment-gated tests skipped |
| Full dashboard suite | Pass: 17 files / 139 tests |
| Full database suite | Pass: 3 files / 19 tests |
| Isolated PostgreSQL schema/payment/audit run | Pass: PostgreSQL 16 schema push plus 7/7 tests, including exact-microsecond paging and replayed tombstone backfill; temporary container removed |
| API, dashboard, and database typecheck | Pass |
| API lint | Pass: 0 errors; existing repository warnings remain |
| Dashboard lint | Pass: 0 errors; 44 existing warnings |
| Database lint | Pass: 0 errors; 41 existing warnings |
| API, dashboard, and database production builds | Pass; existing Vite large-chunk advisory remains |
| Locale parity/placeholders/terminology | Pass in the full dashboard suite for all 8 locales |
| React Doctor changed-scope scan | 29 files scanned; no issues found (reported score 65/100) |
| `git diff --check` | Pass |

The normal full API run keeps its external DB and release-smoke files environment-gated. The PostgreSQL contract suite was additionally run against a fresh isolated PostgreSQL 16 schema and all seven tests passed. Screenshots were not repeated because the authenticated browser fixture was unavailable; capture is non-blocking in the brief.

## Scope

Task 11 fixes only. Migration `0028_booking_request_audit_relationship.sql` adds the immutable audit relationship, guarded row-local and unambiguous sibling backfills, and descending property/request timeline index. No Task 12 amendments, push, or pull request were performed.
