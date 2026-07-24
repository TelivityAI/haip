# iCal calendar bridge (planned)

Many short-term rental and calendar workflows use **iCalendar (RFC 5545)** feeds — `.ics` URLs — to mirror availability and bookings in tools such as **Airbnb**, **Vrbo**, and **Google Calendar**.

## Current status

HAIP’s **native iCal export/import module is in development**. This document describes the intended integration shape so you can plan automations; it does **not** describe a live `/api/v1/...` iCal endpoint yet.

Check your deployment’s OpenAPI at `/docs` and release notes for when iCal routes ship.

## Why iCal

- **Open standard** — one HTTPS URL can be subscribed by multiple calendar clients.
- **STR hand-off** — some hosts sync a master calendar URL into OTAs that support iCal import (policies vary by channel; use HAIP’s channel integrations where certified API sync exists — see **[channels docs](../channels/)**).
- **Staff visibility** — Google Calendar or Outlook can show house-level blocks alongside personal calendars.

## Target design (when available)

Typical HAIP iCal support would include:

| Direction | Purpose |
|-----------|---------|
| **Export feed** | Per-property (or per-room-type) HTTPS URL returning `VEVENT` entries for reservations and holds |
| **Import feed** | Optional URL pull to ingest external blocks as closed inventory |
| **Refresh** | Periodic poll + webhook-driven invalidation when `reservation.*` events fire |

Authentication will likely use **unguessable feed tokens** or property-scoped keys — not guest PII in the URL path.

## Until iCal ships

1. **Webhooks + automation** — subscribe to `reservation.created`, `reservation.modified`, `reservation.cancelled` (**[Webhooks & events](../webhooks.md)**) and create/update events in Google Calendar via API ([slack-teams-discord.md](slack-teams-discord.md) pattern with Google instead of chat).
2. **REST polling** — `GET /api/v1/reservations?propertyId=...` with date filters for batch ETL (respect OAuth staff auth or Connect where applicable).
3. **Certified channel APIs** — for Airbnb/Booking/Expedia, prefer built-in channel modules under `docs/channels/` over iCal when available.

## Security notes

- Treat iCal URLs as secrets — anyone with the link can read booking windows.
- Feeds should minimize guest identifiers; use internal reservation ids in `SUMMARY`/`DESCRIPTION` only if your policy allows.

When iCal endpoints are released, this recipe will be updated with exact paths, token rotation, and refresh intervals.
