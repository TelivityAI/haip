import Keycloak from 'keycloak-js';

/**
 * OIDC client for the dashboard (keycloak-js, PKCE public client).
 *
 * Settings come from the API at runtime (`GET /api/v1/auth/config`, see
 * loadAuthConfig) so one published image serves every environment and any
 * OIDC provider; the build-time VITE_* values are only the fallback when the
 * API does not provide them. `keycloak` and `AUTH_ENABLED` are live bindings:
 * main.tsx awaits loadAuthConfig() before the first render, so every reader
 * sees the runtime values.
 */
export let keycloak = new Keycloak({
  url: import.meta.env.VITE_KEYCLOAK_URL ?? 'http://localhost:8080',
  realm: import.meta.env.VITE_KEYCLOAK_REALM ?? 'haip',
  clientId: import.meta.env.VITE_KEYCLOAK_CLIENT_ID ?? 'haip-dashboard',
});

/**
 * Whether login is required. Build-time default, replaced by the API's answer
 * (the API enforces auth either way, so the dashboard follows it).
 */
export let AUTH_ENABLED = import.meta.env.VITE_AUTH_ENABLED === 'true';

/** Extra keycloak.init() options for the runtime provider (scope, redirect). */
export let authInitOptions: { scope?: string; redirectUri?: string } = {};

/** Role keys that grant a property (scope, not roles) — see oidc-config.ts. */
let propertyRolePrefix = 'property:';

interface RuntimeAuthConfig {
  authEnabled?: boolean;
  oidcIssuer?: string;
  keycloakUrl?: string;
  realm?: string;
  clientId?: string;
  scope?: string;
  propertyRolePrefix?: string;
}

export async function loadAuthConfig(): Promise<void> {
  let cfg: RuntimeAuthConfig;
  try {
    const res = await fetch('/api/v1/auth/config', { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return;
    cfg = (await res.json()) as RuntimeAuthConfig;
  } catch {
    return; // older API or unreachable: keep the build-time settings
  }
  if (typeof cfg.authEnabled === 'boolean') AUTH_ENABLED = cfg.authEnabled;
  const clientId = cfg.clientId ?? 'haip-dashboard';
  if (cfg.oidcIssuer) {
    keycloak = new Keycloak({ clientId, oidcProvider: cfg.oidcIssuer });
    // Generic providers match redirect URIs exactly (no wildcards), so the
    // login always returns to the app root instead of the current deep link.
    authInitOptions = { scope: cfg.scope, redirectUri: `${window.location.origin}/` };
    if (cfg.propertyRolePrefix) propertyRolePrefix = cfg.propertyRolePrefix;
  } else if (cfg.keycloakUrl) {
    keycloak = new Keycloak({ url: cfg.keycloakUrl, realm: cfg.realm ?? 'haip', clientId });
  }
}

const ZITADEL_PROJECT_ROLES = 'urn:zitadel:iam:org:project:roles';

function zitadelRoleKeys(parsed: Record<string, any>): string[] | undefined {
  const generic = parsed[ZITADEL_PROJECT_ROLES];
  if (generic && typeof generic === 'object' && !Array.isArray(generic)) {
    return Object.keys(generic);
  }
  // Per-audience form (API tokenRoleKeys): urn:zitadel:iam:org:project:<aud>:roles
  const audiences = Array.isArray(parsed.aud)
    ? parsed.aud.filter((a): a is string => typeof a === 'string')
    : typeof parsed.aud === 'string'
      ? [parsed.aud]
      : [];
  for (const aud of audiences) {
    const claim = parsed[`urn:zitadel:iam:org:project:${aud}:roles`];
    if (claim && typeof claim === 'object' && !Array.isArray(claim)) {
      return Object.keys(claim);
    }
  }
  return undefined;
}

/**
 * Role keys from a parsed token, mirroring the API's mapping (oidc-config.ts):
 * Keycloak realm roles, Zitadel project roles (generic or per-audience), or a
 * flat `roles` array. Property grants (`property:<uuid>`) are scope, not roles:
 * left out.
 */
export function tokenRoles(parsed: Record<string, any> | undefined): string[] {
  if (!parsed) return [];
  const zitadelKeys = zitadelRoleKeys(parsed);
  const keys: unknown[] = Array.isArray(parsed.realm_access?.roles)
    ? parsed.realm_access.roles
    : zitadelKeys ?? (Array.isArray(parsed.roles) ? parsed.roles : []);
  return keys.filter(
    (k): k is string => typeof k === 'string' && !k.startsWith(propertyRolePrefix),
  );
}
