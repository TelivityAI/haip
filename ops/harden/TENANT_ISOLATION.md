# Tenant isolation gate (self-hosted HAIP)

Run before enabling real hotel tenants. Uses two Keycloak users / properties.

## Prerequisites

- HAIP API with `AUTH_ENABLED=true`
- Two Keycloak users whose JWTs include:
  - User A: `property_ids=[PROPERTY_A]`, roles include staff or `admin`
  - User B: `property_ids=[PROPERTY_B]`
- Environment (see [`.env.harden.example`](./.env.harden.example)):

| Variable | Meaning |
|----------|---------|
| `HAIP_API_BASE` | API base ending in `/api` (e.g. `http://localhost:3000/api`) |
| `TOKEN_A` / `TOKEN_B` | Bearer JWTs for users A and B |
| `PROPERTY_A` / `PROPERTY_B` | Property UUIDs |
| `RESERVATION_IN_B` | Optional — reservation id that belongs only to B |
| `OWNER_TOKEN` | Optional — owner JWT whose `property_ids` contains both A and B |
| `OWNER_PROPERTY_A` / `OWNER_PROPERTY_B` | Two properties available to that same owner |
| `OWNER_RESERVATION_IN_B` / `OWNER_GUEST_IN_B` | Entities linked only to property B |
| `OWNER_ROOM_TYPE_IN_A` / `OWNER_RATE_PLAN_IN_A` | Valid property-A ids used to exercise reservation creation |

## Automated probe

```bash
set -a && source .env.harden && set +a
pnpm harden:live
```

## Pass criteria

1. `GET /v1/health` → **200** with `status: ok` (public)
2. `GET /v1/reservations?propertyId=PROPERTY_A` with **no** token → **401**
3. `GET /v1/reservations?propertyId=PROPERTY_B` with `TOKEN_A` → **403** (or **401** if claim missing)
4. `GET /v1/reservations?propertyId=PROPERTY_A` with `TOKEN_A` → **200** (A may read A)
5. If `RESERVATION_IN_B` is set: `GET /v1/reservations/RESERVATION_IN_B?propertyId=PROPERTY_B` with `TOKEN_A` → **403** or **404**
6. Token without usable `property_ids` / wrong issuer → **401** (configure a bad token as `TOKEN_BAD` optional)

## Multi-property owner invariants (same account)

An owner JWT may hold `property_ids=[A, B]`. Still required:

1. Request with `propertyId=A` + entity id that only exists under B → **404**
2. `POST /reservations` with `propertyId=A` and a `guestId` only linked at B → **404**
3. SPA property switch clears cached detail data; detail routes key by `propertyId`

The CLI executes these probes automatically when all `OWNER_*` variables are
set. When they are absent it reports one clean `SKIP`, leaving the existing
two-user tenant probes unchanged. The create probe uses configurable future
dates (`OWNER_TEST_ARRIVAL` / `OWNER_TEST_DEPARTURE`) and must return **404**
before any booking or reservation is inserted.

## After changes

Re-run `pnpm harden:live` after any change to auth guards, property scoping, or JWT claim mapping.
