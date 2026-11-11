# Generic OIDC login (Zitadel, Authentik, Authelia, Entra ID, …)

HAIP validates staff JWTs from **Keycloak by default**. Setting `OIDC_ISSUER` switches the API to any
standards-compliant OIDC provider, and the dashboard reads its login settings from the API **at
runtime** (`GET /api/v1/auth/config`), so the published image works behind any domain without a
rebuild ([#388](https://github.com/TelivityAI/haip/issues/388)).

Nothing changes for Keycloak deployments: with `OIDC_ISSUER` unset the issuer, JWKS path, claims and
`azp` allow-list behave exactly as before, and the dashboard keeps its build-time `VITE_*` settings
unless `DASHBOARD_KEYCLOAK_URL` is set.

## API environment

| Variable | Required | Meaning |
|----------|----------|---------|
| `OIDC_ISSUER` | yes (generic mode) | Exact `iss` of the provider's tokens, e.g. `https://auth.example.com` |
| `OIDC_JWKS_URI` | yes (generic mode) | Signing keys; Zitadel: `<issuer>/oauth/v2/keys`. Required because providers disagree on the path |
| `OIDC_AUDIENCE` | recommended | Value the token's `aud` must contain (Zitadel: the **project id**). Falls back to `KEYCLOAK_AUDIENCE`, then `KEYCLOAK_CLIENT_ID` |
| `OIDC_ALLOWED_AZP` / `KEYCLOAK_ALLOWED_AZP` | optional | Client ids allowed as `azp`. In generic mode `*` accepts any client: `aud` is then the boundary — useful when every integration has its own service account |
| `OIDC_PROPERTY_ROLE_PREFIX` | optional | Role-key prefix that grants a property (default `property:` → `property:<uuid>`) |
| `DASHBOARD_OIDC_CLIENT_ID` | yes (generic mode) | Public (PKCE) client the dashboard logs in with (default `haip-dashboard`) |
| `DASHBOARD_OIDC_SCOPE` | optional | Login scope (default `openid profile email`); Zitadel: add `urn:zitadel:iam:org:project:id:<project id>:aud` if the project id is not already in `aud` |
| `DASHBOARD_OIDC_ISSUER` | optional | Issuer as the **browser** reaches it, when it differs from `OIDC_ISSUER` |
| `DASHBOARD_KEYCLOAK_URL` / `_REALM` / `_CLIENT_ID` | optional | Runtime dashboard settings for **Keycloak** (no rebuild) |

## Claims HAIP reads

| HAIP field | Keycloak | Generic OIDC |
|------------|----------|--------------|
| roles | `realm_access.roles` | Zitadel `urn:zitadel:iam:org:project:roles` (object keyed by role, or its `…:project:<audience>:roles` form), else a flat `roles` array |
| property scope | `property_ids` | `property_ids` if present, else role keys `property:<uuid>` |
| local user link | `sub` → `users.keycloak_sub`, then `email` | same; `keycloak_sub` is `text` since migration 0032, so non-UUID subjects (Zitadel's are numeric) link fine |

Property roles are scope, not roles: they are stripped from `roles`, so `@Roles()` never matches them.

## Zitadel in five steps

1. **Project** `haip` with *Assert roles on authentication* on. Roles: the realm roles from
   [`keycloak/haip-realm.json`](../../keycloak/haip-realm.json) (`admin`, `front_desk`, …) plus one
   `property:<uuid>` per property.
2. **Dashboard app**: type *User Agent*, auth method *PKCE* (none), **access token type JWT**, *add
   user roles to the access token* and *user info inside ID token* on; redirect `https://<pms>/` and
   post-logout `https://<pms>`.
3. **Service account** per integration: access token type **JWT**, client secret; user grant on the
   project with `property:<uuid>` (and no platform role — `admin` bypasses property scope). Token:
   `POST <issuer>/oauth/v2/token`, `grant_type=client_credentials`, scope
   `openid urn:zitadel:iam:org:project:id:<project id>:aud urn:zitadel:iam:org:projects:roles`.
4. **Local user**: `pnpm integration:link -- --property-id <uuid> --keycloak-sub <token sub> …`
   (see [Service principal](service-principal.md)).
5. **API env**: `OIDC_ISSUER`, `OIDC_JWKS_URI=<issuer>/oauth/v2/keys`, `OIDC_AUDIENCE=<project id>`,
   `KEYCLOAK_ALLOWED_AZP=*`, `DASHBOARD_OIDC_CLIENT_ID=<dashboard client id>`.

Cron scripts take the token endpoint from `OIDC_TOKEN_URL` (and `OIDC_TOKEN_SCOPE`); see
[scripts/cron/README.md](../../scripts/cron/README.md).
