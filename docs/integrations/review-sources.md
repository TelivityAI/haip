# Google & TripAdvisor review pull

Light adapters to **pull** public reviews into HAIP for the review-response agent. Manual review entry via `POST /api/v1/agents/:propertyId/reviews` remains unchanged.

Catalog names: **Google Business Profile Reviews**, **TripAdvisor Content API**.

## Google Places

| Variable | Required | Description |
|----------|----------|-------------|
| `GOOGLE_PLACES_API_KEY` | Yes | Google Cloud API key with Places API enabled |
| `GOOGLE_PLACES_PLACE_ID` | Optional | Default `place_id` if not sent per request |

## TripAdvisor Content API

| Variable | Required | Description |
|----------|----------|-------------|
| `TRIPADVISOR_API_KEY` | Yes | TripAdvisor partner Content API key |
| `TRIPADVISOR_LOCATION_ID` | Optional | Default location id if not sent per request |

Partner access is required for live TripAdvisor data; without keys, pulls are logged only (console fallback).

## Pull reviews

```http
POST /api/v1/reviews/pull
Authorization: Bearer <staff JWT>
Content-Type: application/json

{
  "propertyId": "<uuid>",
  "source": "google",
  "placeId": "ChIJ…"
}
```

```http
POST /api/v1/reviews/pull
Content-Type: application/json

{
  "propertyId": "<uuid>",
  "source": "tripadvisor",
  "locationId": "12345"
}
```

Response shape:

```json
{
  "pulled": true,
  "provider": "google",
  "reviews": [
    {
      "externalId": "google-…",
      "guestName": "…",
      "rating": 5,
      "reviewText": "…",
      "source": "google"
    }
  ]
}
```

Import into `guest_reviews` (dedupe by `externalId`) can be added in a follow-up; this wave exposes pull-only stubs aligned with existing review sources in the database enum (`google`, `tripadvisor`).

Wave 3 reputation consoles (TrustYou, Trustpilot, and related packs) use the same pull endpoint with additional `source` values — see [wave3-reviews.md](./wave3-reviews.md).

See also: [Integration catalog](../INTEGRATIONS.md) — **Reviews & Reputation**.
