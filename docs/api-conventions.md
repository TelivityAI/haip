# API conventions (staff REST)

Integrator notes for HAIP’s staff API (`/api/v1/*`). Live field contracts remain in OpenAPI at `/docs`. This page documents shapes and asymmetries that cost failed dry-runs when they are only discoverable by trial and error (see [#321](https://github.com/TelivityAI/haip/issues/321)).

Connect API (`/api/v1/connect/*`) is a separate surface (bearer confirmation / API key) and is not covered here.

## 1. `propertyId` location

| Operation style | Where `propertyId` goes |
|-----------------|-------------------------|
| Reads / list / get-by-id / most `:id` mutations | Query: `?propertyId=` |
| Creates that embed the tenant on the row | JSON body `propertyId` (preferred) |

**Query alias on selected creates:** `POST /rooms/types`, `POST /rate-plans`, and `POST /reservations/:id/notes` also accept `?propertyId=` when the body omits it. If both are sent, they must match or the API returns `400`.

Do not infer `propertyId` from another entity id (confused-deputy). Always send it on the request.

## 2. Cancel reason field names

`PATCH /reservations/:id/cancel` accepts an optional body:

- `cancellationReason` — preferred for the staff API
- `reason` — alias (same meaning as Connect / bulk cancel)

Empty body is allowed. Sending an undeclared field still fails validation (`forbidNonWhitelisted`).

## 3. Non-modifiable fields on `PATCH /reservations/:id`

Allowed: dates, room type, rate plan, total amount, occupancy, special requests, `doNotMove`.

**Not patchable** (intentional provenance / lifecycle):

- `source`, `channelCode`
- Status (use dedicated routes: confirm, assign, cancel, no-show, check-in, check-out, …)
- Primary guest / booking confirmation number

Unknown body keys are rejected by the global validation pipe.

## 4. Response envelopes (exceptions)

There is **no** single global `{ data }` wrapper. Resource handlers return different top-level keys:

| Endpoint | Top-level shape |
|----------|-----------------|
| `GET /reservations` | `{ data, total, page, limit, hasMore }` |
| `GET /reservations/:id` | `{ reservation, guest, roomType, ratePlan, room, confirmationNumber }` |
| `GET /reservations/:id/notes` | `{ notes, activeCount }` |
| Many list endpoints | `{ data, … }` or a bare array |

Clients must read the documented key for each route. Do not iterate an object’s keys assuming the payload is a list.

## 5. List pagination

Reservation list defaults: `page=1`, `limit=20` (max 100).

The list payload always includes:

- `data` — current page
- `total` — full match count (use this to detect truncation)
- `page`, `limit`
- `hasMore` — `true` when `page * limit < total`

A “list all” client must page until `hasMore` is false (or `data.length === 0`).

## 6. External reservation reference

`bookings.external_confirmation` is writable on **direct create** and **import**, not only channel inbound:

- `POST /reservations` — optional body field `externalConfirmation`
- `POST /reservations/import` — per-row optional `externalConfirmation` (with `channelCode`, used for idempotent dedupe)

Unknown field names are stripped/rejected; use camelCase `externalConfirmation` exactly.
