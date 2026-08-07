# base-13 — Family waiting; stayover room still dirty

## Guest story
Arriving family is in the lobby. Their assigned room is still a **stayover dirty**. Kids are restless; GM is glancing at the desk. Someone must free a clean room without making the family wait through a folio tour.

## Staff job
`housekeeping_supervisor` on `/housekeeping` (+ `/rooms` if needed): see the blocked arrival, push clean/inspect or reassign path so Front Desk can put them up — **without** wandering into Folios/Billing.

## Surfaces
`/housekeeping`, `/rooms`

## Delight if
Clear dirty/stayover signal + action; family gets a room without ops chaos.

## Annoy if
Must leave HK into unrelated modules to understand the block.

## Block if
HK dashboard broken (e.g. 500) so supervisor cannot act.

## Severity if fail
**BLOCKER** if HK cannot run the board; **FRICTION** if path is slow/confusing.
