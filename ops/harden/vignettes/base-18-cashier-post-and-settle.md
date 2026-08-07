# base-18 — Restaurant charge then settle at desk

## Guest story
In-house guest signed a dinner charge to the room. At checkout they want to **see the charge and pay**. Cashier/desk must post/settle without a treasure hunt.

## Staff job
`cashier` / `front_desk` on `/folios` (+ Front Desk): find folio, confirm charge, take payment / settle, then checkout path.

## Surfaces
`/folios`, `/front-desk`

## Delight if
Charge visible; settle → checkout coherent.

## Annoy if
Charge exists in ops lore but not on the folio UI.

## Block if
Cannot post/settle; checkout silently ignores balance (ties to base-07).

## Severity if fail
**BLOCKER** on financial integrity; **FRICTION** if path is slow.
