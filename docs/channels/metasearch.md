# Metasearch via HAIP direct booking

HAIP does not ship a Google Hotel Ads / Tripadvisor / trivago adapter in-core.
Metasearch campaigns should use:

1. **Channel manager meta products** (SiteMinder Demand Plus, DerbySoft Digital Marketing) when the property already connects through those adapters, or
2. **HAIP booking-engine deep links** as the landing destination for Free Booking Links / CPC programs you operate yourself.

## Deep-link contract

Utility: `buildBookingDeepLink` in `apps/api/src/modules/booking-engine/deep-link.ts`.

Required query params for the booking app:

| Param | Meaning |
|-------|---------|
| `propertyId` | Tenant property UUID |
| `key` | Booking engine public key |
| `checkIn` / `checkOut` | ISO dates (optional for homepage) |
| `adults` / `children` | Occupancy |
| `roomTypeId` / `ratePlanId` | Optional preselect |
| `clickId` | Partner attribution |

Example:

```
https://book.example.com/?propertyId=<uuid>&key=<bookingKey>&checkIn=2026-08-01&checkOut=2026-08-03&adults=2&clickId=gha-xyz
```

## Price accuracy

Feeds must match what `/api/v1/booking-engine` returns for the same stay. Prefer CM-operated campaigns until HAIP is a registered Google Hotel Center partner.
