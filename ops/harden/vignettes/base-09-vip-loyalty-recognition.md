# base-09 — Loyalty guest expects to be recognized

## Guest story
A repeat / VIP guest arrives. They expect the desk to see status without them “proving” who they are for three minutes.

## Staff job
`front_desk` on `/front-desk` or arrivals: spot VIP/loyalty (if product supports it) and open the profile without losing the arrival.

## Surfaces
`/front-desk`, `/guests`

## Delight if
Status visible at arrivals / match; desk greets accordingly.

## Annoy if
Status exists but never shown at desk surfaces.

## Block if
Wrong guest’s VIP data shown (trust break).

## Severity if fail
**FRICTION** missing/hard to see; **BLOCKER** on cross-guest bleed; **NOTE** if feature absent from shipped UI (`NEEDS_DOMAIN` OK).
