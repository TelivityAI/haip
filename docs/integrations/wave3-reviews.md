# Wave 3 review consoles

Nine reputation catalog entries expose **named console** review sources on `POST /api/v1/reviews/pull`. Without vendor credentials they log the handoff and return an empty pull (same honesty model as Google/TripAdvisor when keys are unset).

| Catalog slug | `source` |
|--------------|----------|
| trustyou | `trustyou` |
| customer-alliance | `customer-alliance` |
| trustpilot | `trustpilot` |
| yotpo | `yotpo` |
| mara-ai | `mara-ai` |
| guest-suite | `guest-suite` |
| facebook-page-ratings | `facebook-page-ratings` |
| reviewtrackers | `reviewtrackers` |
| foursquare-places | `foursquare-places` |

```http
POST /api/v1/reviews/pull
Authorization: Bearer <staff JWT>
Content-Type: application/json

{
  "propertyId": "<uuid>",
  "source": "trustyou"
}
```

Live vendor HTTP requires partner API access and a real provider replacing the console pack. Google Places and TripAdvisor Content API remain the only HTTP-capable review pulls today — see [review-sources.md](./review-sources.md).

## Demos

```bash
./integrations/demos/run.sh trustyou
./integrations/demos/run.sh trustpilot
```
