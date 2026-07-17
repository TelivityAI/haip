# DerbySoft Property Connector adapter

HAIP integrates DerbySoft via the **Property Connector (PC) Integration API** — REST/JSON, OAuth Bearer tokens, PUSH/PUSH for ARI and reservations.

Partner onboarding: contact **pms.service@derbysoft.net** for `client_id` / `client_secret` (account credentials).

## What HAIP implements

| Capability | Direction | HAIP surface |
|------------|-----------|--------------|
| Token obtain/refresh | PMS → DerbySoft | `POST …/account/token` (Basic → Bearer) |
| Update Inventory | PMS → DerbySoft | `ChannelAdapter.pushAvailability` |
| Update Rate | PMS → DerbySoft | `ChannelAdapter.pushRates` |
| Update Availability (restrictions) | PMS → DerbySoft | `ChannelAdapter.pushRestrictions` |
| Update Hotel / RoomType | PMS → DerbySoft | `pushContent` / `POST /channels/connections/:id/sync-property` |
| Update Reservation Status | PMS → DerbySoft | `confirmReservation` / `cancelReservation` |
| Live Check | DerbySoft → PMS | `POST /api/v1/channels/inbound/derbysoft/availability` |
| Book / Modify / Cancel | DerbySoft → PMS | `…/book`, `…/modify`, `…/cancel` |
| Ping | DerbySoft → PMS | `…/ping` |
| Full Overlay flush | PMS → DerbySoft | `POST /channels/push/full-flush` (async) or `ariUpdateType=Overlay` |

## Connection config

Store on `channelConnections.config`:

```json
{
  "hotelId": "YOUR_PMS_HOTEL_ID",
  "accountId": "client_id_from_derbysoft",
  "clientSecret": "client_secret_from_derbysoft",
  "tunnelBaseUrl": "https://pcendpoint.derbysoft-test.com/pcapigateway/tunnel/{accountId}",
  "profileBaseUrl": "https://pcendpoint.derbysoft-test.com/pcapigateway/profile/{accountId}",
  "tokenUrl": "https://pcendpoint.derbysoft-test.com/pcapigateway/account/token",
  "ariUpdateType": "Delta",
  "inboundAuth": {
    "bearerToken": "shared-secret-derbysoft-presents-to-haip"
  },
  "roomTypeMapping": [{ "roomTypeId": "…", "channelRoomCode": "King" }],
  "ratePlanMapping": [{ "ratePlanId": "…", "channelRateCode": "BAR" }]
}
```

Env defaults (local mock):

| Variable | Default |
|----------|---------|
| `DERBYSOFT_TOKEN_URL` | `http://localhost:4002/pcapigateway/account/token` |
| `DERBYSOFT_TUNNEL_BASE_URL` | `http://localhost:4002/pcapigateway/tunnel/{accountId}` |
| `DERBYSOFT_PROFILE_BASE_URL` | `http://localhost:4002/pcapigateway/profile/{accountId}` |
| `DERBYSOFT_ACCOUNT_ID` | `haip_test` |
| `DERBYSOFT_CLIENT_SECRET` | `test_password` |
| `DERBYSOFT_HOTEL_ID` | `MOCK_DS_HOTEL` |

## Local mock

```bash
docker compose --profile channels up -d mock-derbysoft
# or: node tools/mock-derbysoft/server.mjs   # :4002
```

## Rate limiting

Outbound client enforces **15 requests/second** (vendor limit). HTTP 429 triggers a short backoff + retry.

## Delta vs Overlay

- **Delta** (default): incremental ARI changes.
- **Overlay**: full refresh for a date window (property launch / manual refresh). Use `ariUpdateType: "Overlay"` on push DTOs or `POST /channels/push/full-flush`.

## Source channel tracking

Inbound reservations set `channelCode` to `derbysoft:<distributorId>` (e.g. `derbysoft:CTRIP`) so multi-OTA traffic through DerbySoft stays distinguishable in bookings.

## PCI

Book/Modify payloads may include card data. HAIP **strips** `payment` and `threeDomainSecurity` before any persistence (`rawPayload`). Never store PAN/CVV.

## Partner checklist

1. Email `pms.service@derbysoft.net` for TEST account (`client_id` / `client_secret`).
2. Register PMS webhook base URL: `https://<your-host>/api/v1/channels/inbound/derbysoft` (paths `/availability`, `/book`, `/modify`, `/cancel`, `/ping`).
3. Share inbound Bearer token; store as `config.inboundAuth.bearerToken`.
4. Create HAIP channel connection (`adapterType=derbysoft`) with hotel/room/rate mappings.
5. Run property sync + Overlay ARI flush for the sellable window.
6. Certify Live Check → Book → Modify → Cancel against TEST endpoint.
7. Switch tunnel/profile/token URLs to PROD (`pcendpoint.derbysoftsec.com`) when certified.

## Vendor docs

- [API Overview](https://pc.knowledgebase.derbysoftsec.com/en/support/solutions/articles/70000157127-api-overview)
- [ARI](https://pc.knowledgebase.derbysoftsec.com/en/support/solutions/articles/70000157130-ari)
- [Reservation](https://pc.knowledgebase.derbysoftsec.com/en/support/solutions/articles/70000157128-reservation)
- [Account / Token](https://pc.knowledgebase.derbysoftsec.com/en/support/solutions/articles/70000663114)
