# base-05 — Guest wants a quieter room (move / DNM)

## Guest story
Stayover guest complains about noise and asks to move. Housekeeping or desk may have marked do-not-move; guest is at the desk now, not “later via email.”

## Staff job
`front_desk` on `/front-desk`: move to another vacant room; if DNM, explicit override/ack path — not a silent ignore.

## Surfaces
`/front-desk`

## Delight if
Move completes on Front Desk; new room shows on the stay immediately.

## Annoy if
Must bounce to Rooms/Reservations to finish the move.

## Block if
No in-house room move at all.

## Severity if fail
**BLOCKER** if move impossible; **FRICTION** if path is buried.
