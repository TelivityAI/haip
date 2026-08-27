# Service principal (Keycloak JWT for staff REST)

Server-to-server integrations that need **staff REST** routes (`/api/v1/reservations`, `/api/v1/rooms`, …) authenticate with a **Keycloak service account** JWT, not a dashboard login.

For OTA-style search/book and webhook subscriptions, prefer **[Connect API key](connect-api-key.md)** (`x-api-key`) — no Keycloak, no local user row.

## When to use which

| Need | Use |
|------|-----|
| Search/book/cancel via confirmation number, webhook subscriptions | Connect `x-api-key` |
| Folio inbound / POS charges | Connect `x-api-key` |
| Full staff REST (rooms, reservations, reports, night audit, …) | **Service principal** (this doc) |

## What you assemble (five pieces)

1. **Keycloak confidential client** with service accounts enabled.
2. **`aud` claim** — audience mapper so `aud` includes `haip-api` (or your `KEYCLOAK_CLIENT_ID`).
3. **`azp` allow-list** — add your client id to API `KEYCLOAK_ALLOWED_AZP` ([#317](https://github.com/TelivityAI/haip/pull/317)).
4. **`property_ids` claim** — hardcoded-claim mapper listing property UUID(s) the integration may access.
5. **Local HAIP user** — `users.keycloak_sub` + a role with the right permission keys (`@RequirePermissions` routes).

Steps 1–4 are Keycloak; step 5 is `pnpm integration:link` (replaces operator SQL).

## 1. Keycloak client

1. Create a **confidential** client (example: `my-integration`).
2. Enable **Service accounts roles**.
3. On the **Service accounts roles** tab, assign a realm role matching your profile:
   - `integration_inventory` — room / room-type / ops tooling
   - `integration_reservations` — reservations + guests read/write
4. Add mappers (see [keycloak/README.md](../../keycloak/README.md) for JSON snippets):
   - **Audience** → included audience `haip-api`
   - **Hardcoded claim** → `property_ids`, multivalued, your property UUID(s)

Obtain a token (client credentials):

```bash
curl -sS -X POST "$KEYCLOAK_URL/realms/haip/protocol/openid-connect/token" \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -d "grant_type=client_credentials" \
  -d "client_id=my-integration" \
  -d "client_secret=<secret>"
```

Decode the access token and copy **`sub`** (service-account user id) and confirm `property_ids` and `aud`.

## 2. API environment

In `apps/api/.env` (or deployment env):

```bash
AUTH_ENABLED=true
KEYCLOAK_URL=http://localhost:8080
KEYCLOAK_REALM=haip
KEYCLOAK_CLIENT_ID=haip-api
KEYCLOAK_ALLOWED_AZP=haip-dashboard,my-integration
```

`KEYCLOAK_ALLOWED_AZP` must include every client id that obtains tokens for this API. Unset = only `KEYCLOAK_CLIENT_ID` (unchanged legacy behaviour).

## 3. Link local principal

Demo property id from `pnpm seed`: `a0000001-0000-4000-a000-000000000001`.

```bash
pnpm integration:link -- \
  --property-id a0000001-0000-4000-a000-000000000001 \
  --keycloak-sub <sub-from-jwt> \
  --label enquiry-pipeline \
  --profile inventory
```

Profiles:

| `--profile` | Built-in role | Permissions |
|-------------|---------------|-------------|
| `inventory` | `integration_inventory` | `rooms.read`, `rooms.write`, `ops.manage` |
| `reservations` | `integration_reservations` | `reservations.read/write`, `guests.read/write`, `rooms.read` |
| `custom` | Property custom role | `--permissions` comma list (see allowlist in code) |

Re-running the command is **idempotent** (same `keycloakSub` updates name; ensures role assignment).

### Multi-property principals

One Keycloak service account can operate on several properties: the JWT `property_ids` claim is multivalued, and `PermissionsGuard` resolves grants per request `propertyId` via `user_roles`. Link the same `keycloakSub` on each property — either run `integration:link` once per property, or pass a comma-separated list:

```bash
pnpm integration:link -- \
  --property-id a0000001-0000-4000-a000-000000000001,b0000002-0000-4000-b000-000000000002 \
  --keycloak-sub <sub-from-jwt> \
  --label booking-pipeline \
  --profile custom \
  --permissions reservations.read,reservations.write,folios.read
```

`users.propertyId` on the local row is the principal's **home** property (set on the first link). It is not a constraint — additional properties are linked only through `user_roles`.

## 4. Verify

```bash
export TOKEN="<access_token>"
export PROPERTY_ID="a0000001-0000-4000-a000-000000000001"

curl -sS "http://localhost:3000/api/v1/rooms/types?propertyId=$PROPERTY_ID" \
  -H "Authorization: Bearer $TOKEN"
```

Room-type **writes** require `ops.manage` (`inventory` profile). List room types is unauthenticated on some routes — prefer a mutating check only in a test environment.

## Errors (intentional)

| Message | Meaning |
|---------|---------|
| `Invalid token audience (azp mismatch)` | Client not in `KEYCLOAK_ALLOWED_AZP` |
| `You do not have access to this property` | `property_ids` missing or wrong property |
| `No local user account is linked to this login` | Run `pnpm integration:link` with token `sub` |
| `Access denied. Required permission(s): …` | Linked user lacks local grants — widen profile or use `custom` |

The **“No local user account is linked to this login”** message names `PermissionsGuard` exactly — preserve it when extending auth.

## Cron / scheduled jobs

Same client-credentials flow; see [scripts/cron/README.md](../../scripts/cron/README.md).

## Related

- [#322](https://github.com/TelivityAI/haip/issues/322) — design discussion
- [#317](https://github.com/TelivityAI/haip/pull/317) — `KEYCLOAK_ALLOWED_AZP`
