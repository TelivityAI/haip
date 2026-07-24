# Go live — Beds24

## 60-second demo
```bash
./integrations/demos/run.sh beds24
```
Creates a channel connection with `adapterType=beds24`. Missing credentials → console stub (logged, no vendor HTTP).

## Live in a jiffy
1. Get API keys from the channel manager / distribution partner.
2. Either set env fallbacks from [`demo.env.example`](./demo.env.example) **or** PATCH the connection `config` JSON with the keys.
3. Map room types / rate plans (`channelRoomCode` / `channelRateCode`).
4. Push ARI:
   ```http
   POST /api/v1/channels/connections/{id}/push-availability?propertyId={uuid}
   POST /api/v1/channels/connections/{id}/push-rates?propertyId={uuid}
   ```
5. Pull a test reservation (or send inbound) and confirm it lands in HAIP.

Docs: docs/integrations/channel-beds24-channex.md
