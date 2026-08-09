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
  "imported": 2,
  "updated": 0,
  "newReviewIds": ["…"],
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

Pull results are persisted into `guest_reviews` with dedupe on `(propertyId, source, externalId)`. Re-sync updates `lastSyncedAt` without duplicating rows. New reviews trigger the `review_response` agent automatically.

Wave 3 reputation consoles (TrustYou, Trustpilot, and related packs) use the same pull endpoint with additional `source` values — see [wave3-reviews.md](./wave3-reviews.md).

See also: [Integration catalog](../INTEGRATIONS.md) — **Reviews & Reputation**.
