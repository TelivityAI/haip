# Task 11 review-fix report — booking request operations workspace

## Outcome

Resolved the Task 11 review findings without changing Task 12.

- Property socket rooms recover after token refresh/reconnect. The dashboard leaves the previous property before joining the next, rejoins the active property on every socket `connect`, and cleans up its handler without duplication.
- Realtime invalidation consumes the actual `{ event, data, timestamp }` envelope and uses the authenticated active property room. Booking-request, payment, reservation, folio, audit, and guest-communication events invalidate every property-scoped booking-request workspace prefix; a known request ID also invalidates the exact request keys.
- The safe queue DTO exposes submitted/requested total and currency, with accepted total separate. Whitelisted server-side sorting runs before pagination (including numeric requested-total sorting), and the dashboard performs one list call rather than N+1 detail reads.
- Acceptance uses a property-scoped preview with submitted/current authoritative totals and an opaque versioned fingerprint. The locked acceptance transaction recomputes the quote and returns `409` before mutation when it changed; the modal refreshes the preview while preserving the draft.
- Denial stays blocked until the payment/resolution query succeeds. Loading, unknown, and failure states cannot be mistaken for zero money exposure.
- Audit history is read directly from property/request-owned entity IDs, ordered stably by `occurredAt` and ID, capped at 100 rows per page, and exposed through load-more pagination. The allowlisted DTO includes safe summaries/actor display while removing processor tokens, claims, idempotency, consent, application answers, internal IDs, and provider secrets. A composite property/entity/timeline index and migration support the bounded query.
- Payment availability is calculated by the same server helper used by allocation: net captured minus negative child movements, existing allocations, and pending/legacy reserved resolutions without double-counting. The safe DTO exposes net/allocated/reserved/available values.
- Payment movement provenance is derived server-side as `saved_card` or `external` from trusted origin data, never a user-entered provider label. The dashboard selects Refund versus External Return only from that discriminator.
- Installment reorder is a single property/request-scoped bulk mutation. It locks the request and installment set, validates an exact unique ID set, writes contiguous order atomically, and records one audit event. Allocated installments permit order-only changes; rollback and concurrent calls are covered.
- All staff money fields validate canonical decimal strings without rounding, enforce currency precision (including JPY), reject zero/nonnumeric/excess precision, and preserve exact submitted text.
- Native dialog lifecycle, independent Accept/Deny versus payment actions, per-delivery retry pending state, keyboard reorder controls, permissions, and request-scoped query keys remain intact.
- All eight locale namespaces have key/placeholder parity and context-appropriate PMS vocabulary, with targeted German, Croatian, Italian, Serbian-Latin, French, Spanish, and Portuguese terminology regressions.

## TDD evidence

Red/green cycles covered socket reconnect/property switching, reservation-ID-only realtime envelopes, audit rows lacking legacy aggregate payload fields, bounded audit pagination, queue list call count/server sorting, captured/refunded/reserved allocation arithmetic, trusted provenance, atomic reorder rollback/concurrency, and locale terminology. The final audit regression failed with an empty history before the server-owned entity-set check was corrected, then passed with the related sanitization tests.

## Verification

| Check | Result |
| --- | --- |
| Focused API decision/payment suites | Pass: 103 tests |
| Focused dashboard queue/property/realtime suites | Pass: 30 tests |
| Full API suite | Pass: 220 files / 1,836 tests; 2 files / 6 environment-gated tests skipped |
| Full dashboard suite | Pass: 17 files / 135 tests |
| Full database suite | Pass: 3 files / 15 tests |
| API, dashboard, and database typecheck | Pass |
| API lint | Pass: 0 errors; 2,652 existing warnings |
| Dashboard lint | Pass: 0 errors; 44 existing warnings |
| Database lint | Pass: 0 errors; 41 existing warnings |
| API, dashboard, and database production builds | Pass; existing Vite large-chunk advisory remains |
| Locale parity/placeholders/terminology | Pass in the full dashboard suite for all 8 locales |
| React Doctor changed-scope scan | 28 files scanned; no issues found after the memo dependency fix |
| `git diff --check` | Pass |

The live Postgres payment spec was invoked through the full API run and remained environment-gated because `DATABASE_URL` is not available. Schema shape and migration-safety tests pass locally. Screenshots were not repeated because the authenticated browser fixture was unavailable; capture is non-blocking in the brief.

## Scope

Task 11 fixes only. One Task 11 audit timeline index migration was added. No Task 12 amendments, push, or pull request were performed.
