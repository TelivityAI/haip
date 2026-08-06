# base-07 — Due out but still owes money

## Guest story
Guest tries to leave with an open minibar / unpaid charge. They’ll get angry if the desk “checks them out anyway” or if nobody can show the balance and take payment.

## Staff job
`front_desk` / `cashier`: attempt checkout; **block or force settlement**; show amount and next action.

## Surfaces
`/front-desk`, `/folios`

## Delight if
Clear balance + pay/settle path; no silent bypass.

## Annoy if
Error is opaque (“failed”) with no folio jump.

## Block if
Checkout succeeds while balance remains outstanding with no warning.

## Severity if fail
**BLOCKER** on silent bypass; **FRICTION** if blocked but settle path is obscure.
