# CRM & marketing via Connect webhooks

Wire guest lifecycle events into Mailchimp, HubSpot, Brevo, ActiveCampaign, Zendesk, Cendyn, Keap, or any CRM that accepts HTTP — **without** a HAIP-hosted OAuth connector.

This recipe uses existing surfaces only:

- **[Connect subscriptions](../webhooks.md#subscribing)** — `POST /api/v1/connect/subscriptions`
- **[Connect API keys](connect-api-key.md)** — fetch guest/reservation details after a lean webhook
- Optional automation hosts: [n8n](webhooks-n8n.md), [Make](webhooks-make.md), [Zapier](webhooks-zapier.md)

## Catalog rows covered

| Catalog slug | Typical use |
|--------------|-------------|
| `mailchimp` | Audience / tag sync on stay events |
| `hubspot-free-crm` | Contact + deal activity from reservations |
| `brevo` | Marketing lists / transactional journeys |
| `activecampaign` | Automation tags and sequences |
| `zendesk` | Support tickets from guest messaging / reviews |
| `cendyn` | Hotel CRM audience handoff |
| `keap` | Small-business contact follow-ups |

## Pattern

1. Create a Connect API key for the property ([connect-api-key.md](connect-api-key.md)).
2. Subscribe to the events your CRM needs, for example:

```json
POST /api/v1/connect/subscriptions
{
  "propertyId": "<uuid>",
  "subscriberId": "crm-mailchimp",
  "subscriberName": "Mailchimp sync",
  "callbackUrl": "https://hooks.example.com/haip-crm",
  "events": ["reservation.created", "reservation.checked_in", "reservation.checked_out", "guest.*"],
  "secret": "<long-random-hmac-secret>"
}
```

3. In your middleware (or n8n/Make), verify `X-HAIP-Signature`, then `GET` the entity by id via the staff/Connect API.
4. Upsert the contact in the CRM using **that vendor’s** documented API (keys live only in your middleware — never in HAIP).

## What HAIP does not do

- No embedded Mailchimp/HubSpot/… OAuth apps in this recipe wave
- No inventing vendor CRM field maps — map fields in your middleware against vendor docs

## Demos

```bash
./integrations/demos/run.sh mailchimp
./integrations/demos/run.sh hubspot-free-crm
```

Each demo enables the catalog toggle; live CRM sync still requires your webhook endpoint and vendor keys.
