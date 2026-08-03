# Channex PMS certification (HAIP)

HAIP ships a real Channex `ChannelAdapter` (`adapterType: channex`). This document is the runbook for connecting **Channex staging** to a HAIP / haip-cloud staging environment and collecting evidence for the [official certification tests](https://docs.channex.io/api-v.1-documentation/pms-certification-tests).

> Certification is a **product UI → integration path** review. Do not use Postman or standalone scripts to generate task IDs for the form. Channex will re-run actions from the HAIP UI on a live screenshare.

## Pre-flight (must be true before Stage 2)

| Requirement | HAIP path |
|-------------|-----------|
| ARI changes fire on PMS actions | `AriService` listens to `reservation.*` and `rate_plan.updated` / `rate_restriction.*` |
| Batched ARI (not per-day spam) | Channex mappers collapse consecutive identical days into `date_from` / `date_to` |
| Retry on 429 / 5xx | `ChannexAdapter.postValues` exponential backoff |
| ≤ ~20 ARI requests / minute | Client-side pacing in `ChannexAdapter` |
| Booking webhook + ACK | `POST /api/v1/channels/inbound/channex/bookings` + `booking_revisions/{id}/ack` |
| Mapping layer | `channelConnections.roomTypeMapping` / `ratePlanMapping` → Channex UUIDs |
| Task IDs retained | `ChannelSyncResult.taskIds` stored in `ari_sync_logs.response` |

## Staging topology

```
HAIP / haip-cloud staging API
  baseUrl: https://staging.channex.io/api/v1
  connection.config:
    apiKey, propertyId (Channex UUID), baseUrl, inboundAuth.secret
  webhook callback:
    https://<staging-api-host>/api/v1/channels/inbound/channex/bookings
    header X-Channex-Webhook-Secret: <same secret>
```

Production default (do **not** use for certification): `https://api.channex.io/api/v1`.

### Connect from haip-cloud Channels UI

1. Open **Channels → Add Connection → Channex**.
2. Set Channex property UUID, user API key, base URL `https://staging.channex.io/api/v1`, webhook secret.
3. Map HAIP room types → Channex `room_type_id`, rate plans → `rate_plan_id`.
4. Activate connection → **Test Connection**.
5. Register the webhook in Channex staging (property or global) with `event_mask=booking` and the secret header.

### Connect via API

```http
POST /api/v1/channels/connections?propertyId={haip-property-uuid}
Content-Type: application/json

{
  "channelCode": "channex",
  "channelName": "Channex Staging",
  "adapterType": "channex",
  "config": {
    "apiKey": "<staging user-api-key>",
    "propertyId": "<channex-property-uuid>",
    "baseUrl": "https://staging.channex.io/api/v1",
    "inboundAuth": { "secret": "<random-shared-secret>" }
  },
  "roomTypeMapping": [
    { "roomTypeId": "<haip-rt-uuid>", "channelRoomCode": "<channex-room-type-uuid>" }
  ],
  "ratePlanMapping": [
    { "ratePlanId": "<haip-rp-uuid>", "channelRateCode": "<channex-rate-plan-uuid>" }
  ]
}
```

Activate (`status: active`) then:

```http
POST /api/v1/channels/connections/{id}/test?propertyId={haip-property-uuid}
```

## Channex staging property setup (cert mapping)

Name the property `Test Property - HAIP` (USD). Create:

- Twin Room (occ 2) + Double Room (occ 2)
- Per room: Best Available Rate (100) + Bed & Breakfast (120)

Fetch UUIDs via Channex Property / Room Type / Rate Plan APIs and store them in HAIP mappings.

## Stage 2 scenarios → HAIP actions

| # | Cert scenario | Trigger in HAIP (not scripts) | Evidence |
|---|----------------|-------------------------------|----------|
| 1 | Full sync (500 days, 2 calls) | Channels → **Push Full ARI (500d)** or `POST …/push/full` with 500-day window | `taskIds` in sync log (availability + rates) |
| 2–8 | Rate / restriction deltas | Rate Plans UI: change price / min LOS / stop-sell / CTA/CTD for mapped dates | Sync log `taskIds` from automatic `pushRates` |
| 9–10 | Availability deltas | Create/modify/cancel a reservation in HAIP for those nights | Sync log from `reservation.*` → `pushAvailability` |
| 11 | Booking receive + ACK | Create/modify/cancel via Channex Booking CRS (or Booking.com test channel); webhook → HAIP reservation | Reservation in HAIP + revision left the feed after ACK |
| 12 | Rate limits | Confirm pacing / queue notes in Extra Notes (client limiter + batching) | Code path in `ChannexAdapter` |
| 13 | Delta-only (no timer full sync) | Agree — HAIP only full-syncs on explicit UI/API action | Document in form |
| 14 | Extra Notes | See answers below | Form |

### Extra Notes (draft answers)

- **Min stay:** `min_stay_arrival` only (not `min_stay_through`).
- **Restrictions supported:** stop sell, CTA, CTD, min LOS, max LOS.
- **Multiple room types / rate plans:** yes.
- **Card data with bookings:** no (PCI via Stripe when charging in HAIP).
- **PCI:** card data not stored; Stripe tokenization for payments.

## Webhook registration (Channex staging)

```http
POST https://staging.channex.io/api/v1/webhooks
user-api-key: <key>
Content-Type: application/json

{
  "webhook": {
    "callback_url": "https://<staging-api-host>/api/v1/channels/inbound/channex/bookings",
    "event_mask": "booking",
    "property_id": "<channex-property-uuid>",
    "is_active": true,
    "send_data": true,
    "headers": {
      "X-Channex-Webhook-Secret": "<same-as-inboundAuth.secret>"
    }
  }
}
```

With `send_data: false`, HAIP still pulls `booking_revisions/feed` on notification.

Unauthorized requests (wrong/missing secret) must return **401**.

## Collecting task IDs

After each UI-driven push, read:

```http
GET /api/v1/channels/sync-logs/{connectionId}?propertyId={uuid}&limit=20
```

`response.taskIds` (or `response.result.taskIds`) are the values for the Google certification form.

## Stage 4 screenshare checklist

1. Open haip-cloud (or HAIP dashboard) Channels — show active Channex staging connection.
2. Change a BAR price in Rate Plans → show Channex calendar update + task id in sync logs.
3. Create a walk-in reservation → availability drops in Channex.
4. Create a booking in Channex Booking CRS → reservation appears in HAIP and feed ACKs.
5. Optionally open `channex.adapter.ts` / `ari.service.ts` event handlers if asked.

## Related

- Adapter: `apps/api/src/modules/channel/adapters/channex/`
- Integration overview: [channel-beds24-channex.md](../integrations/channel-beds24-channex.md)
- Demo: `integrations/demos/channex/`
- Official tests: https://docs.channex.io/api-v.1-documentation/pms-certification-tests
- Form: https://forms.gle/xA8F3eSYBPBd8apYA
