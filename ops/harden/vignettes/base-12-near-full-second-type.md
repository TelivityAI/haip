# base-12 — Peak night, second room type sold out mid-flow

## Guest story
Family needs two rooms at arrival peak. First type is fine; **second type shows unavailable** mid-flow. They’re already emotionally invested — don’t leave a half-booking mess.

## Staff job
`front_desk` on `/front-desk`: recover — alternate type, reduce rooms, or abort cleanly; keep first selection coherent.

## Surfaces
`/front-desk`

## Delight if
Clear unavailable message + clean recovery without orphan stays.

## Annoy if
Confusing error but recoverable.

## Block if
Silent fail, corrupt partial booking, or forced unlinked second walk-in.

## Severity if fail
**BLOCKER** on corrupt/duplicate-walk-in; **FRICTION** if recoverable but messy.
