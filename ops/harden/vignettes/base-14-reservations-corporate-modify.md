# base-14 — Corporate guest extends stay, direct bill

## Guest story
A corporate traveler on **direct bill** calls/emails: extend two nights. Company will pay; they don’t want a panic “we lost your rate” conversation.

## Staff job
`reservations` on `/reservations` (rate glance OK): find the stay, extend dates, keep corporate/direct-bill context without rebuilding the booking from scratch.

## Surfaces
`/reservations`

## Delight if
Modify dates in one coherent flow; confirmation still makes sense.

## Annoy if
Must cancel + recreate; direct bill context dropped.

## Block if
No modify path and no honest failure — silent corruption.

## Severity if fail
**FRICTION** if workaround exists; **BLOCKER** if stay cannot be extended safely; `NEEDS_DOMAIN` if product has no modify at all.
