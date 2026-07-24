# Beds24 & Channex channel managers

Connect HAIP to **Beds24** or **Channex** as the channel manager that pushes OTAs while HAIP remains the PMS of record.

See the **[integration catalog](../INTEGRATIONS.md)** (Channel Managers) for where these fit in the roadmap.

## Prerequisites

- A HAIP property with room types and rate plans mapped to channel codes (`channelRoomCode`, `channelRateCode`).
- A channel connection using adapter type `beds24` or `channex`.
- Vendor credentials (API key / property keys) stored on the connection `config` JSON or in server env vars.

## Beds24

### Connection config

| Field | Env fallback | Purpose |
|-------|----------------|---------|
| `apiKey` | `BEDS24_API_KEY` | Account API key (Settings → Account) |
| `propKey` | `BEDS24_PROP_KEY` | Property key (Settings → Properties → Access) |
| `baseUrl` | `BEDS24_BASE_URL` | Default `https://api.beds24.com/json` |

Create a connection:

```http
POST /api/v1/channels/connections?propertyId={uuid}
Content-Type: application/json

{
  "channelCode": "beds24",
  "adapterType": "beds24",
  "config": {
    "apiKey": "YOUR_API_KEY",
    "propKey": "YOUR_PROP_KEY"
  }
}
```

### ARI push

HAIP pushes availability and rates via Beds24 **setRoomDates** when you call:

- `POST /api/v1/channels/connections/{id}/push-availability?propertyId={uuid}`
- `POST /api/v1/channels/connections/{id}/push-rates?propertyId={uuid}`
- `POST /api/v1/channels/connections/{id}/push-restrictions?propertyId={uuid}`

Room type mappings must use the Beds24 **roomId** as `channelRoomCode`.

### Booking import

Poll Beds24 bookings into HAIP:

```http
POST /api/v1/channels/connections/{id}/pull-reservations?propertyId={uuid}
```

Uses **getBookings** with optional `modifiedSince` from the last sync timestamp.

When credentials are missing, the adapter runs in **console mode** (logged stub, no HTTP).

## Channex

### Connection config

| Field | Env fallback | Purpose |
|-------|----------------|---------|
| `apiKey` | `CHANNEX_API_KEY` | `user-api-key` header |
| `propertyId` | `CHANNEX_PROPERTY_ID` | Channex property UUID |
| `baseUrl` | `CHANNEX_BASE_URL` | Default `https://api.channex.io/api/v1` |

```http
POST /api/v1/channels/connections?propertyId={uuid}
Content-Type: application/json

{
  "channelCode": "channex",
  "adapterType": "channex",
  "config": {
    "apiKey": "YOUR_USER_API_KEY",
    "propertyId": "CHANNEX_PROPERTY_UUID"
  }
}
```

Map HAIP room types to Channex **room_type_id** and rate plans to **rate_plan_id**.

### ARI push

- Availability → `POST …/availability`
- Rates & restrictions → `POST …/restrictions`

Same HAIP push endpoints as other channel adapters (`push-availability`, `push-rates`, `push-restrictions`).

### Booking feed

```http
POST /api/v1/channels/connections/{id}/pull-reservations?propertyId={uuid}
```

Pulls unacknowledged revisions from **booking_revisions/feed**. After HAIP creates the reservation, confirm back to Channex:

```http
POST /api/v1/channels/connections/{id}/confirm-reservation?propertyId={uuid}
```

(Body includes the Channex revision/booking id as `externalConfirmation`.)

Console mode applies when `apiKey` or `propertyId` is absent.

## Test connection

```http
POST /api/v1/channels/connections/{id}/test?propertyId={uuid}
```

Returns `{ connected, message }` from the adapter’s live credential check.

## Related docs

- [Webhooks & events](../webhooks.md) — automate pulls on a schedule via n8n/Make/Zapier recipes under [integrations/](README.md).
- Certified OTAs (Booking.com, Expedia, DerbySoft, SiteMinder) — see `docs/channels/` for direct OTA adapters.
