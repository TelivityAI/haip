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

interface RuntimeAuthConfig {
  authEnabled?: boolean;
  oidcIssuer?: string;
  keycloakUrl?: string;
  realm?: string;
  clientId?: string;
  scope?: string;
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
  } else if (cfg.keycloakUrl) {
    keycloak = new Keycloak({ url: cfg.keycloakUrl, realm: cfg.realm ?? 'haip', clientId });
  }
}

/**
 * Role keys from a parsed token, mirroring the API's mapping (oidc-config.ts):
 * Keycloak realm roles, Zitadel project roles, or a flat `roles` array.
 */
export function tokenRoles(parsed: Record<string, any> | undefined): string[] {
  if (!parsed) return [];
  if (Array.isArray(parsed.realm_access?.roles)) return parsed.realm_access.roles;
  const zitadel = parsed['urn:zitadel:iam:org:project:roles'];
  if (zitadel && typeof zitadel === 'object' && !Array.isArray(zitadel)) {
    return Object.keys(zitadel);
  }
  return Array.isArray(parsed.roles) ? parsed.roles : [];
}
