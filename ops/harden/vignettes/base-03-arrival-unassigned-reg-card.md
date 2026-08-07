# base-03 — Arrival waiting, room still unassigned

## Guest story
OTA guest arrives on time. Reservation exists but **no room assigned**. They’re standing at the desk with ID ready; next guest is already in line.

## Staff job
`front_desk` on `/front-desk`: assign a clean room and complete check-in / reg in one Arrivals pass.

## Surfaces
`/front-desk`

## Delight if
Assigned + checked in without leaving Arrivals; guest gets a room number quickly.

## Annoy if
Must open Reservations or Rooms to finish assign.

## Block if
Cannot assign from desk flow; check-in succeeds with no room and no hard warning.

## Severity if fail
**BLOCKER** if check-in cannot complete; **FRICTION** if assign is buried.
