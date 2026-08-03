# Wave 3 channel consoles + Wise Platform

## Channel managers (console adapters)

Eleven channel-manager `adapterType` values are registered as **console** adapters (same stub pattern as Beds24 without credentials). They accept ARI/reservation calls and log handoffs — no vendor HTTP until a partner client replaces the console implementation.

| Catalog slug | adapterType |
|--------------|-------------|
| expedia-eqc | `expedia_eqc` |
| myallocator-cloudbeds | `myallocator_cloudbeds` |
| atomize | `atomize` |
| yieldplanet | `yieldplanet` |
| d-edge | `d_edge` |
| cubilis-lighthouse | `cubilis_lighthouse` |
| rategain | `rategain` |
| hotelrunner | `hotelrunner` |
| nextpax | `nextpax` |
| hotelbeds-api-suite | `hotelbeds` |
| amadeus-self-service-hotel-apis | `amadeus_hotel` |

Create a connection:

```http
POST /api/v1/channels/connections
{ "propertyId": "...", "channelCode": "yieldplanet", "channelName": "YieldPlanet", "adapterType": "yieldplanet", "config": {} }
```

## Wise Platform

`PAYMENT_GATEWAY=wise` selects a console payment gateway until a Wise Platform partner HTTP client is implemented.

## Demos

```bash
./integrations/demos/run.sh yieldplanet
./integrations/demos/run.sh wise-platform
```
