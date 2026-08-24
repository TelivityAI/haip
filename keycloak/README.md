# Keycloak realm (`haip`)

Local docker-compose imports [`haip-realm.json`](haip-realm.json) on first boot.

## Clients

| Client | Purpose |
|--------|---------|
| `haip-api` | Bearer-only resource server audience (`aud`) |
| `haip-dashboard` | Public SPA (PKCE) |

Integrations should **not** reuse `haip-dashboard`. Create a dedicated **confidential** client with service accounts.

## Integration realm roles

Shipped in `haip-realm.json` for assignment to service-account users:

| Realm role | Use |
|------------|-----|
| `integration_inventory` | Room inventory tooling (`rooms.read`, `rooms.write`, `ops.manage` locally) |
| `integration_reservations` | Enquiry / booking pipelines (`reservations.*`, `guests.*`, `rooms.read`) |

Local permission grants still come from HAIP `role_permissions` — run `pnpm integration:link` after Keycloak setup.

## Mapper snippets (Admin Console)

Add to your integration client (or a dedicated client scope assigned to it).

### Audience (`aud` includes API client)

- Mapper type: **Audience**
- Included Client Audience: `haip-api`
- Add to access token: **ON**

### Property scope (`property_ids`)

- Mapper type: **Hardcoded claim**
- Token Claim Name: `property_ids`
- Claim value: your property UUID (e.g. demo `a0000001-0000-4000-a000-000000000001`)
- Claim JSON Type: String
- Add to access token: **ON**
- Multivalued: **ON** (repeat claim or use multiple values per Keycloak version UI)

For multiple properties, add multiple values or use a script mapper — HAIP expects a JSON array of UUID strings on the claim.

### Example hardcoded claim JSON (import-oriented)

```json
{
  "name": "property-ids",
  "protocol": "openid-connect",
  "protocolMapper": "oidc-hardcoded-claim-mapper",
  "config": {
    "claim.name": "property_ids",
    "claim.value": "a0000001-0000-4000-a000-000000000001",
    "jsonType.label": "String",
    "access.token.claim": "true",
    "multivalued": "true"
  }
}
```

## Full setup guide

See [docs/integrations/service-principal.md](../docs/integrations/service-principal.md).
