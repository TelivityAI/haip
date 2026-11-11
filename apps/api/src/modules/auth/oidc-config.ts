/**
 * Identity-provider settings shared by every token verifier (JwtStrategy for
 * HTTP, WsAuthService for sockets) and by the dashboard's runtime auth config.
 *
 * Two modes, chosen by OIDC_ISSUER:
 *
 * - Keycloak (OIDC_ISSUER unset — the default, unchanged): issuer is
 *   `${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}` and the JWKS lives at
 *   `${issuer}/protocol/openid-connect/certs`.
 * - Generic OIDC (OIDC_ISSUER set): any standards-compliant provider
 *   (Zitadel, Authentik, Authelia, Entra ID, …). OIDC_JWKS_URI is required,
 *   because providers do not agree on the JWKS path.
 *
 * Pure functions over a key lookup, so they are unit-testable without Nest.
 */

export type EnvLookup = (key: string) => string | undefined;

export interface OidcVerifierConfig {
  /** Exact `iss` the token must carry. */
  issuer: string;
  jwksUri: string;
  /** Single audience the token's `aud` must contain. */
  audience: string;
  /** Clients allowed as `azp`. `null` = any (only in generic mode, via `*`). */
  allowedAzp: string[] | null;
  /** Role-key prefix that grants a property, e.g. `property:<uuid>`. */
  propertyRolePrefix: string;
  generic: boolean;
}

const DEFAULT_PROPERTY_ROLE_PREFIX = 'property:';

function read(get: EnvLookup, key: string): string | undefined {
  const value = get(key)?.trim();
  return value ? value : undefined;
}

export function resolveOidcVerifierConfig(get: EnvLookup): OidcVerifierConfig {
  const genericIssuer = read(get, 'OIDC_ISSUER');
  const audience =
    read(get, 'OIDC_AUDIENCE') ??
    read(get, 'KEYCLOAK_AUDIENCE') ??
    read(get, 'KEYCLOAK_CLIENT_ID') ??
    'haip-api';
  const azpList = (read(get, 'OIDC_ALLOWED_AZP') ?? read(get, 'KEYCLOAK_ALLOWED_AZP') ?? audience)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const propertyRolePrefix =
    read(get, 'OIDC_PROPERTY_ROLE_PREFIX') ?? DEFAULT_PROPERTY_ROLE_PREFIX;

  if (genericIssuer) {
    const jwksUri = read(get, 'OIDC_JWKS_URI');
    if (!jwksUri) {
      throw new Error('OIDC_JWKS_URI is required when OIDC_ISSUER is set');
    }
    return {
      issuer: genericIssuer,
      jwksUri,
      audience,
      // `*` is honoured only with a generic issuer: there the audience check is
      // the boundary (one service account per integration cannot be listed
      // ahead of time). In Keycloak mode a literal `*` names no client.
      allowedAzp: azpList.includes('*') ? null : azpList,
      propertyRolePrefix,
      generic: true,
    };
  }

  const keycloakUrl = read(get, 'KEYCLOAK_URL') ?? 'http://localhost:8080';
  const realm = read(get, 'KEYCLOAK_REALM') ?? 'haip';
  const issuer = `${keycloakUrl}/realms/${realm}`;
  return {
    issuer,
    jwksUri: read(get, 'OIDC_JWKS_URI') ?? `${issuer}/protocol/openid-connect/certs`,
    audience,
    allowedAzp: azpList,
    propertyRolePrefix,
    generic: false,
  };
}

/** Whether the token's `azp` (if any) is an allowed client. */
export function azpAllowed(config: OidcVerifierConfig, azp: unknown): boolean {
  if (azp === undefined || azp === null || azp === '') return true;
  if (config.allowedAzp === null) return true;
  return typeof azp === 'string' && config.allowedAzp.includes(azp);
}

const ZITADEL_PROJECT_ROLES = 'urn:zitadel:iam:org:project:roles';

function objectKeys(value: unknown): string[] | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.keys(value as Record<string, unknown>);
  }
  return undefined;
}

function stringArray(value: unknown): string[] | undefined {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string');
  return undefined;
}

/**
 * Every role key the token carries, before property roles are split off:
 * Keycloak `realm_access.roles`; Zitadel's project-roles claim (an object
 * keyed by role, generic or per-audience form); or a flat `roles` array
 * (Entra ID, Auth0-style providers).
 */
export function tokenRoleKeys(payload: any, audience: string): string[] {
  return (
    stringArray(payload?.realm_access?.roles) ??
    objectKeys(payload?.[ZITADEL_PROJECT_ROLES]) ??
    objectKeys(payload?.[`urn:zitadel:iam:org:project:${audience}:roles`]) ??
    stringArray(payload?.roles) ??
    []
  );
}

/** The identity HAIP needs from a verified token. */
export function principalFromPayload(
  payload: any,
  config: Pick<OidcVerifierConfig, 'audience' | 'propertyRolePrefix'>,
) {
  const keys = tokenRoleKeys(payload, config.audience);
  const prefix = config.propertyRolePrefix;
  const fromRoles = keys
    .filter((k) => k.startsWith(prefix))
    .map((k) => k.slice(prefix.length))
    .filter(Boolean);
  const explicit = stringArray(payload?.property_ids);
  return {
    sub: payload?.sub,
    email: payload?.email ?? '',
    name: payload?.name ?? payload?.preferred_username ?? '',
    roles: keys.filter((k) => !k.startsWith(prefix)),
    propertyIds: explicit ?? (fromRoles.length > 0 ? fromRoles : undefined),
  };
}

/**
 * What the dashboard needs to start its login at runtime, so one published
 * image serves every environment (issue #388). Only public values: never a
 * secret. With neither OIDC_ISSUER nor DASHBOARD_KEYCLOAK_URL set, the
 * dashboard keeps its build-time (VITE_*) settings.
 */
export function dashboardAuthConfig(get: EnvLookup): Record<string, unknown> {
  const authEnabled = (get('AUTH_ENABLED') ?? 'true') !== 'false';
  const issuer = read(get, 'OIDC_ISSUER');
  if (issuer) {
    return {
      authEnabled,
      oidcIssuer: read(get, 'DASHBOARD_OIDC_ISSUER') ?? issuer,
      clientId: read(get, 'DASHBOARD_OIDC_CLIENT_ID') ?? 'haip-dashboard',
      scope: read(get, 'DASHBOARD_OIDC_SCOPE') ?? 'openid profile email',
      propertyRolePrefix: read(get, 'OIDC_PROPERTY_ROLE_PREFIX') ?? DEFAULT_PROPERTY_ROLE_PREFIX,
    };
  }
  const keycloakUrl = read(get, 'DASHBOARD_KEYCLOAK_URL');
  if (keycloakUrl) {
    return {
      authEnabled,
      keycloakUrl,
      realm: read(get, 'DASHBOARD_KEYCLOAK_REALM') ?? read(get, 'KEYCLOAK_REALM') ?? 'haip',
      clientId: read(get, 'DASHBOARD_KEYCLOAK_CLIENT_ID') ?? 'haip-dashboard',
    };
  }
  return { authEnabled };
}
