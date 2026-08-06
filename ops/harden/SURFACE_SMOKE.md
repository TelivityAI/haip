# Full-surface smoke (self-hosted HAIP)

Run this on every candidate production (or staging twin) deploy before putting
real guests or chargeable traffic on the instance. Desk vignettes alone are
**not** enough.

## Environment

- Dashboard served by your HAIP API (compose: `http://localhost:3000`)
- Sign in via Keycloak with a staff/admin user for **property A**
- Always open routes with `?propertyId=<PROPERTY_A>`
- Never put passwords in notes or screenshots you share

## Rule

Click the real control. If nothing happens → **BROKEN**.  
Pretty empty page with no path to do the job → **EMPTY_SHELL**.  
Nav that lies / no feedback after a critical action → **CONFUSING**.

Classifications: `BROKEN` | `EMPTY_SHELL` | `CONFUSING` | `PARTIAL` | `WORKS`

## Checklist (engine SPA — no skipping)

| # | Surface | Route | Must prove |
|---|---------|-------|------------|
| 1 | Dashboard | `/` | Loads for the property; not a dead shell |
| 2 | Check-in / Front desk | `/front-desk` | Confirm check-in completes; walk-in path works; clear errors |
| 3 | Reservations | `/reservations` | List + open a reservation; create/modify path clear |
| 4 | Guests | `/guests` | Profile useful mid-shift (stay context / notes — not name-only) |
| 5 | Rooms status | `/rooms` | Change status sticks + visible feedback |
| 6 | Room types | `/rooms/types` | Types list/edit operable |
| 7 | Housekeeping | `/housekeeping` | Tasks load (or clear actionable empty + generate works) |
| 8 | Folios | `/folios` | See bill; post/settle path clear |
| 9 | Cashier | `/cashier` | Post/settle flow usable when folio has balance |
| 10 | Night audit | `/night-audit` | After run: success state + history; not “run again?” forever |
| 11 | Rate plans | `/rate-plans` | Calculate/edits not decorative |
| 12 | Reports | `/reports` | Primary reports load; errors visible |
| 13 | Groups | `/groups` | Group block list/detail operable |
| 14 | Channels | `/channels` | Connection path or honest “not configured” |
| 15 | Communications | `/communications` | Connected path or honest “not configured” |
| 16 | Reviews | `/reviews` | Sync/manual path clear — not a dead empty |
| 17 | Settings / Users | `/settings` | Property settings + users/roles operable |
| 18 | Booking admin | Settings → Booking Engine | Booking key generate/rotate when auth on |
| 19 | Import | `/import` | Import entry honest (works or clear empty) |

Also smoke Walk-In party link + Guest Details — but **never instead of** this list.
Pair with [`vignettes/`](./vignettes/) for desk realism.

## Outputs (suggested)

Write under a local folder you keep private (e.g. `harden-runs/YYYY-MM-DD-surface-smoke/`):

1. `AUDIT.json` — `{id, surface, route, classification, notes}` × each row  
2. `SUMMARY.md` — counts of WORKS / BROKEN / EMPTY_SHELL / …  
3. Screenshots only if useful; scrub guest PII

## Gate

**Invalid run:** skipped surfaces, or vignette-only run labeled as full product smoke.  
**Valid run:** every row attempted.  
**Go-live:** zero Critical on check-in, room status, folios, night-audit feedback, housekeeping.
