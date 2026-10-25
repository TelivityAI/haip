# Ligare Hotels — ChatGPT, Claude, Gemini

Book opted-in HAIP properties inside the assistant: search → prepareBooking → guest pays on the hotel PSP hosted page → confirmPayment → confirmation number.

Gateway must be publicly reachable first (`PUBLIC_BASE_URL`).

## Shared URLs

| Resource | URL |
|----------|-----|
| OpenAPI (ChatGPT Actions) | `<PUBLIC_BASE_URL>/openapi.json` |
| Privacy | `<PUBLIC_BASE_URL>/privacy` |
| MCP (Claude / Gemini) | `<PUBLIC_BASE_URL>/mcp` |
| Health | `<PUBLIC_BASE_URL>/health` |

Staging example (replace after deploy): `https://<ligare-hotels-gateway>/openapi.json`

Action / connector auth: set `GATEWAY_API_KEY` on the gateway and the same value as API Key / Bearer / request header. Never put `HAIP_CONNECT_API_KEY` in the LLM client.

## Booking flow (all LLMs)

1. `searchHotels` — location + dates + occupancy.
2. Present room, rate, **tax-inclusive total**, cancellation policy.
3. Collect name + **email**. Confirm stay details.
4. `prepareBooking` with `Idempotency-Key` (stable per guest intent). Response includes `paymentUrl` + `paymentMode` (`charge` | `authorize` | `guarantee`).
5. Ask the guest to open `paymentUrl` and complete payment (card never enters chat).
6. Call `confirmPayment` until `confirmed` / `paymentStatus=paid`. Only then say the booking succeeded.
7. Give the confirmation number for lookup / modify / cancel.

Never invent availability, prices, or confirmation numbers. Never accept card PANs or payment tokens.

## 1. ChatGPT Custom GPT (Ligare)

ChatGPT → Explore GPTs → Create → Configure.

**Name:** `Ligare Hotels`

**Instructions:** paste the booking flow above; use actions for all hotel work; default 2 adults / 1 room; require email before prepareBooking; always confirmPayment after pay.

**Actions:** Import from URL → `<PUBLIC_BASE_URL>/openapi.json`  
**Authentication:** API Key (Bearer) = `GATEWAY_API_KEY`  
**Privacy policy URL:** `<PUBLIC_BASE_URL>/privacy`

## 2. Claude custom connector

Customize → Connectors → Add → Custom → Web.

- Name: `Ligare Hotels`
- MCP URL: `<PUBLIC_BASE_URL>/mcp`
- Auth: request header `Authorization: Bearer <GATEWAY_API_KEY>` (or `x-api-key`)

## 3. Gemini (API / Enterprise)

Remote MCP Streamable HTTP:

```json
{
  "type": "mcp_server",
  "name": "ligare_hotels",
  "url": "<PUBLIC_BASE_URL>/mcp",
  "headers": { "Authorization": "Bearer <GATEWAY_API_KEY>" }
}
```

Gemini Enterprise: add as Custom MCP Server data store; enable the Ligare tools.

## Property allow-list

Only properties on the gateway allow-list appear in search. Detail/book against a property that is not enabled returns 404 (live check, not search cache).

## Env (gateway)

See `.env.example`. Required: `HAIP_API_BASE_URL`, `HAIP_CONNECT_API_KEY`, `GATEWAY_API_KEY`, `PUBLIC_BASE_URL`, and allow-list via `AI_DISTRIBUTION_BASE_URL` + `AI_DISTRIBUTION_SERVICE_TOKEN` (or `LIGARE_ALLOWED_PROPERTY_IDS` for a static list).
