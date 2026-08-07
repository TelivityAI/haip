# base-04 — In-house guest asks for folio / PIN / who’s on the room

## Guest story
An in-house guest calls the desk: “What’s my folio balance, and can my spouse get a key?” Staff needs Guest Details, folio entry, and accompanying names **from the stay**.

## Staff job
`front_desk` on `/front-desk` (folio link OK as secondary): open stay context, answer balance/PIN/accompanying without losing the guest on hold.

## Surfaces
`/front-desk` (optional secondary `/folios`)

## Delight if
Guest Details + folio path from In-House in a few clicks.

## Annoy if
Must search Guests/Reservations by name with no stay link.

## Block if
In-house stay has no usable guest/folio path.

## Severity if fail
**FRICTION** slow path; **BLOCKER** if unreachable.
