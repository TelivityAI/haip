# base-20 — Reservations books walk-in that FD must finish

## Guest story
Phone rings at reservations during peak: walk-in-ish same-day stay. Reservations starts the booking; guest will be at the desk in 20 minutes for keys.

## Staff job
`reservations` creates/holds the stay on `/reservations`; `front_desk` completes assign/check-in on `/front-desk` without re-entering the whole guest as a new walk-in.

## Surfaces
`/reservations`, `/front-desk`

## Delight if
Handoff is one stay; FD finishes assign/check-in fast.

## Annoy if
FD cannot find the booking; duplicates created.

## Block if
Forced second independent create at the desk.

## Severity if fail
**BLOCKER** if duplicate create required; **FRICTION** if findable but slow.
