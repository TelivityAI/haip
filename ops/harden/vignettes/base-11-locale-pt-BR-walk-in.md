# base-11 — Brazilian guest, desk in pt-BR

## Guest story
Property serves Brazilian guests; desk runs UI in `pt-BR`. Guest asks for a 2-night walk-in — copy must not look broken or untrustworthy.

## Staff job
`front_desk`: complete walk-in with locale `pt-BR` if switcher exists; nights pluralize cleanly; flow still completable.

## Surfaces
`/front-desk` (locale control wherever shipped)

## Delight if
Clear pt-BR nights copy; walk-in finishes.

## Annoy if
Nested English plural junk like `(2 NIGHT(S))` in pt-BR strings.

## Block if
Locale switch prevents completing the walk-in.

## Severity if fail
**FRICTION** for bad copy; **BLOCKER** only if task blocked; **ENV_BLOCKED** if locale unavailable.
