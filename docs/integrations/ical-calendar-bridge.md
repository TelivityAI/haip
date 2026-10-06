# iCal calendar bridge

Many short-term rental and calendar workflows use **iCalendar (RFC 5545)** feeds — `.ics` URLs — to mirror availability and bookings.

## Current status

Staff routes are live under `/api/v1/ical`. Property-scoped routes require `propertyId`.

| Method | Path | Who |
|--------|------|-----|
| GET | `/api/v1/ical/feeds` | admin, revenue_manager |
| POST | `/api/v1/ical/feeds` | admin |
| GET | `/api/v1/ical/feeds/:id` | admin, revenue_manager |
| PATCH | `/api/v1/ical/feeds/:id` | admin |
| DELETE | `/api/v1/ical/feeds/:id` | admin |
| POST | `/api/v1/ical/feeds/:id/sync` | admin, revenue_manager |
| POST | `/api/v1/ical/feeds/:id/rotate-token` | admin |
| GET | `/api/v1/ical/feeds/:id/blocks` | admin, revenue_manager |
| GET | `/api/v1/ical/export.ics?token=` | token, no staff session |

Import sync is manual. There is no scheduler. Create and token rotation return the export URL once. The dashboard screen is Channels → iCal calendars. OpenAPI is at `/docs`.

## Why iCal

- **Open standard** — one HTTPS URL can be subscribed by multiple calendar clients.
- **STR hand-off** — some hosts sync a master calendar URL into OTAs that support iCal import (policies vary by channel; use HAIP’s channel integrations where certified API sync exists — see **[channels docs](../channels/)**).
- **Staff visibility** — a calendar client can show house-level blocks alongside personal calendars.

## What the routes do

| Direction | Behavior |
|-----------|----------|
| **Export feed** | Per room type. `GET /api/v1/ical/export.ics?token=` returns `text/calendar`. The token is the credential. |
| **Import feed** | Staff supply an HTTP(S) calendar URL. `POST /api/v1/ical/feeds/:id/sync?propertyId=` replaces that feed’s busy blocks. |
| **Refresh** | Manual only. Call sync again. No background poll is registered. |

## Security notes

- Treat iCal URLs as secrets — anyone with the link can read booking windows.
- A failed sync keeps the previous blocks. The dashboard does not show the provider error text.
