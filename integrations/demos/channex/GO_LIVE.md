# Go live — Channex

## 60-second demo
```bash
./integrations/demos/run.sh channex
```
Creates a channel connection with `adapterType=channex`. Missing credentials → console stub (logged, no vendor HTTP).

## Staging / certification
1. Sign up at https://staging.channex.io and create a test property + API key.
2. PATCH connection `config` with `apiKey`, `propertyId`, `baseUrl=https://staging.channex.io/api/v1`, and `inboundAuth.secret`.
3. Map room types / rate plans to Channex UUIDs.
4. Register webhook → `POST /api/v1/channels/inbound/channex/bookings` with `X-Channex-Webhook-Secret`.
5. Drive ARI from the Rate Plans / Reservations UI (not Postman) and collect `taskIds` from sync logs.

Full runbook: [docs/channels/channex-certification.md](../../../docs/channels/channex-certification.md)

## Live in a jiffy
1. Get API keys from the channel manager / distribution partner.
2. Either set env fallbacks from [`demo.env.example`](./demo.env.example) **or** PATCH the connection `config` JSON with the keys.
3. Map room types / rate plans (`channelRoomCode` / `channelRateCode`).
4. Push ARI:
   ```http
   POST /api/v1/channels/push/availability
   POST /api/v1/channels/push/rates
   ```
   (body: `propertyId`, `channelConnectionId`, `startDate`, `endDate`)
5. Pull a test reservation (or send inbound webhook) and confirm it lands in HAIP.

Docs: docs/integrations/channel-beds24-channex.md
