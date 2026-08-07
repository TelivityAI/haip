# base-15 — Night audit blocked by due-out with balance

## Guest story
It’s roll time. One due-out still has an open balance. Night auditor must not blindly close the day and invent a ghost checkout — and must not spend 40 minutes hunting the folio.

## Staff job
`night_auditor` on `/night-audit` + `/folios` / Front Desk departures: see the due-out with balance, resolve or consciously defer before audit.

## Surfaces
`/night-audit`, `/folios`, `/front-desk`

## Delight if
Audit surface flags the problem; clear next action.

## Annoy if
Audit runs “fine” while due-out balance is invisible.

## Block if
Occupancy/audit tools 500 so NA cannot close the day.

## Severity if fail
**BLOCKER** if day cannot close safely; **FRICTION** if visible but painful.
