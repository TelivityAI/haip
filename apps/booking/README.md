# @telivityhaip/booking

Guest-facing, commission-free **Book Now** widget for HAIP. A hotel embeds this on
its own website to take direct bookings. Public — authenticates only with a
**publishable booking key** (`x-booking-key`); there is no login.

## Stack

React 18 · Vite · TypeScript · @tanstack/react-query · react-router-dom ·
Tailwind CSS · Stripe Elements. Mirrors `apps/dashboard`.

## Auth model

The publishable booking key is resolved in priority order:

1. `?key=` URL query param
2. `data-booking-key` attribute on the mount element / script
3. `VITE_BOOKING_KEY` env var
4. The demo key `pk_live_HAIPDEMO0000000000000000`

No `propertyId` is ever sent — the API derives it from the key.

## API

Talks to `/api/v1/booking-engine` (same-origin). Override the origin for
cross-origin embeds with `VITE_API_BASE` (e.g. `https://pms.example.com`).

Endpoints used: `GET /config`, `POST /search`, `POST /quote`, `POST /book`,
`GET /bookings/:cn`, `DELETE /bookings/:cn`.

## Scripts

```bash
pnpm --filter @telivityhaip/booking dev        # standalone SPA on :5174
pnpm --filter @telivityhaip/booking build      # tsc -b && vite build
pnpm --filter @telivityhaip/booking preview
pnpm --filter @telivityhaip/booking typecheck
pnpm --filter @telivityhaip/booking lint
pnpm --filter @telivityhaip/booking test
```

## Flow

Search → Results → Room/Rate select (quote) → Guest details → Payment →
Confirmation. A separate **Manage booking** route looks up / cancels a booking
by confirmation number.

Branding (display name, primary/accent colors, logo) is read from `/config`
(and the `/search` `branding` block) and applied via CSS variables, so each
property is themed.

## Payment

If `depositDue > 0` and `/config` returns a `stripePublishableKey`, the Payment
step renders Stripe Elements and sends a Stripe PaymentMethod id as
`paymentToken`. When the key is null/empty (demo/mock mode) it skips Stripe and
submits the placeholder token `tok_demo` (matches the API's MockGateway).

## Embedding

Build, serve `dist/` under `/booking/`, then on the hotel's site:

```html
<div id="haip-booking" data-booking-key="pk_live_XXXXXXXXXXXXXXXXXXXX"></div>
<script src="/booking/embed.js"></script>
```

`embed.js` finds the container and mounts the React widget into it (using an
in-memory router, so it never touches the host page's URL). All Tailwind
utilities are scoped under `.haip-booking` (Tailwind `important: '.haip-booking'`)
so the widget's styles don't clobber the host page.
