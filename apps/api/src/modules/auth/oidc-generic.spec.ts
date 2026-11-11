import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { generateKeyPairSync } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { JwtStrategy } from './jwt.strategy';
import { WsAuthService } from './ws-auth.service';
import {
  dashboardAuthConfig,
  principalFromPayload,
  resolveOidcVerifierConfig,
} from './oidc-config';

/**
 * Generic OIDC (issue #388): a non-Keycloak issuer — here shaped like Zitadel —
 * must verify through the same JwtStrategy / WsAuthService, with roles and
 * property scope read from the provider's own claims. Keycloak mode must not
 * change at all.
 */

const env = (vars: Record<string, string | undefined>) => (key: string) => vars[key];

const PROJECT = '345678901234567890';
const PROPERTY = 'a0000001-0000-4000-a000-000000000001';

// A Zitadel access token: numeric sub, project id in aud, roles as an object
// keyed by role (value = { orgId: orgDomain }), no realm_access, no email.
const zitadelPayload = (extra: Record<string, unknown> = {}) => ({
  sub: '77776025198584418',
  aud: [PROJECT, '345678901234567891'],
  azp: '345678901234567892',
  'urn:zitadel:iam:org:project:roles': {
    front_desk: { '111': 'scds.localhost' },
    [`property:${PROPERTY}`]: { '111': 'scds.localhost' },
  },
  ...extra,
});

describe('resolveOidcVerifierConfig', () => {
  it('Keycloak mode is unchanged when OIDC_ISSUER is unset', () => {
    const c = resolveOidcVerifierConfig(
      env({ KEYCLOAK_URL: 'http://kc.test', KEYCLOAK_REALM: 'haip', KEYCLOAK_CLIENT_ID: 'haip-api' }),
    );
    expect(c.issuer).toBe('http://kc.test/realms/haip');
    expect(c.jwksUri).toBe('http://kc.test/realms/haip/protocol/openid-connect/certs');
    expect(c.audience).toBe('haip-api');
    expect(c.allowedAzp).toEqual(['haip-api']);
    expect(c.generic).toBe(false);
  });

  it('generic mode takes issuer, JWKS and audience from OIDC_*', () => {
    const c = resolveOidcVerifierConfig(
      env({
        OIDC_ISSUER: 'https://auth.example.com',
        OIDC_JWKS_URI: 'https://auth.example.com/oauth/v2/keys',
        OIDC_AUDIENCE: PROJECT,
      }),
    );
    expect(c.issuer).toBe('https://auth.example.com');
    expect(c.jwksUri).toBe('https://auth.example.com/oauth/v2/keys');
    expect(c.audience).toBe(PROJECT);
    expect(c.generic).toBe(true);
  });

  it('generic mode without OIDC_JWKS_URI fails fast instead of guessing a path', () => {
    expect(() => resolveOidcVerifierConfig(env({ OIDC_ISSUER: 'https://auth.example.com' }))).toThrow(
      /OIDC_JWKS_URI/,
    );
  });

  it('`*` in the azp allow-list means "any" only with a generic issuer', () => {
    const generic = resolveOidcVerifierConfig(
      env({ OIDC_ISSUER: 'https://a', OIDC_JWKS_URI: 'https://a/k', KEYCLOAK_ALLOWED_AZP: '*' }),
    );
    expect(generic.allowedAzp).toBeNull();
    const keycloak = resolveOidcVerifierConfig(env({ KEYCLOAK_ALLOWED_AZP: '*' }));
    expect(keycloak.allowedAzp).toEqual(['*']);
  });
});

describe('principalFromPayload', () => {
  const cfg = { audience: PROJECT, propertyRolePrefix: 'property:' };

  it('maps a Zitadel token: roles from the project-roles object, scope from property: roles', () => {
    const p = principalFromPayload(zitadelPayload(), cfg);
    expect(p.sub).toBe('77776025198584418');
    expect(p.roles).toEqual(['front_desk']);
    expect(p.propertyIds).toEqual([PROPERTY]);
    expect(p.email).toBe('');
  });

  it('reads the per-audience Zitadel claim when the generic one is absent', () => {
    const p = principalFromPayload(
      {
        sub: '1',
        [`urn:zitadel:iam:org:project:${PROJECT}:roles`]: { admin: {} },
      },
      cfg,
    );
    expect(p.roles).toEqual(['admin']);
    expect(p.propertyIds).toBeUndefined();
  });

  it('an explicit property_ids claim wins over property: roles', () => {
    const p = principalFromPayload(zitadelPayload({ property_ids: ['b0000002-0000-4000-b000-000000000002'] }), cfg);
    expect(p.propertyIds).toEqual(['b0000002-0000-4000-b000-000000000002']);
  });

  it('Keycloak tokens map exactly as before', () => {
    const p = principalFromPayload(
      { sub: 'kc-1', email: 'a@b.c', realm_access: { roles: ['admin'] }, property_ids: [PROPERTY] },
      cfg,
    );
    expect(p).toEqual({ sub: 'kc-1', email: 'a@b.c', name: '', roles: ['admin'], propertyIds: [PROPERTY] });
  });

  it('a flat roles array (Entra ID style) is read too', () => {
    expect(principalFromPayload({ sub: 'x', roles: ['readonly'] }, cfg).roles).toEqual(['readonly']);
  });

  it('a token without any role claim has no roles and no property scope', () => {
    const p = principalFromPayload({ sub: 'x' }, cfg);
    expect(p.roles).toEqual([]);
    expect(p.propertyIds).toBeUndefined();
  });
});

describe('dashboardAuthConfig', () => {
  it('generic mode hands the dashboard issuer, client id and scope — never a secret', () => {
    const out = dashboardAuthConfig(
      env({
        AUTH_ENABLED: 'true',
        OIDC_ISSUER: 'https://auth.example.com',
        OIDC_JWKS_URI: 'https://auth.example.com/oauth/v2/keys',
        DASHBOARD_OIDC_CLIENT_ID: 'dash-1',
        KEYCLOAK_CLIENT_SECRET: 's3cret',
      }),
    );
    expect(out).toEqual({
      authEnabled: true,
      oidcIssuer: 'https://auth.example.com',
      clientId: 'dash-1',
      scope: 'openid profile email',
      propertyRolePrefix: 'property:',
    });
    expect(JSON.stringify(out)).not.toContain('s3cret');
  });

  it('runtime Keycloak settings when DASHBOARD_KEYCLOAK_URL is set', () => {
    expect(dashboardAuthConfig(env({ DASHBOARD_KEYCLOAK_URL: 'https://kc.example.com' }))).toEqual({
      authEnabled: true,
      keycloakUrl: 'https://kc.example.com',
      realm: 'haip',
      clientId: 'haip-dashboard',
    });
  });

  it('nothing configured: only authEnabled, the dashboard keeps its build-time settings', () => {
    expect(dashboardAuthConfig(env({ AUTH_ENABLED: 'false' }))).toEqual({ authEnabled: false });
    // Same default as the guards: auth is ON unless explicitly 'false'.
    expect(dashboardAuthConfig(env({}))).toEqual({ authEnabled: true });
  });
});

describe('JwtStrategy.validate with a generic issuer', () => {
  const base = {
    OIDC_ISSUER: 'https://auth.example.com',
    OIDC_JWKS_URI: 'https://auth.example.com/oauth/v2/keys',
    OIDC_AUDIENCE: PROJECT,
  };
  const strategy = (vars: Record<string, string>) =>
    new JwtStrategy(new ConfigService(vars) as any);

  it('`*` accepts any azp (the aud check is the boundary)', () => {
    const s = strategy({ ...base, KEYCLOAK_ALLOWED_AZP: '*' });
    expect(s.validate(zitadelPayload()).propertyIds).toEqual([PROPERTY]);
  });

  it('without `*`, an azp outside the list is still refused', () => {
    const s = strategy({ ...base, KEYCLOAK_ALLOWED_AZP: 'some-other-client' });
    expect(() => s.validate(zitadelPayload())).toThrow(UnauthorizedException);
  });
});

/**
 * End to end through WsAuthService: a real RS256 signature checked against a
 * JWKS served over HTTP, as the provider would. Proves issuer and audience are
 * enforced for a generic issuer, and that a numeric `sub` survives.
 */
describe('WsAuthService.verify against a generic OIDC JWKS', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const kid = 'test-key-1';
  let server: Server;
  let jwksUri = '';
  const issuer = 'https://auth.example.com';

  beforeAll(async () => {
    const jwk = { ...(publicKey.export({ format: 'jwk' }) as object), kid, use: 'sig', alg: 'RS256' };
    server = createServer((_req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ keys: [jwk] }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    jwksUri = `http://127.0.0.1:${(server.address() as AddressInfo).port}/oauth/v2/keys`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const service = (extra: Record<string, string> = {}) =>
    new WsAuthService(
      new ConfigService({
        OIDC_ISSUER: issuer,
        OIDC_JWKS_URI: jwksUri,
        OIDC_AUDIENCE: PROJECT,
        KEYCLOAK_ALLOWED_AZP: '*',
        ...extra,
      }) as any,
    );

  const sign = (payload: Record<string, unknown>, opts: jwt.SignOptions = {}) =>
    jwt.sign(payload, privateKey, { algorithm: 'RS256', keyid: kid, issuer, expiresIn: 300, ...opts });

  it('accepts a Zitadel-shaped token and maps its claims', async () => {
    const { aud, ...rest } = zitadelPayload();
    const user = await service().verify(sign(rest, { audience: aud }));
    expect(user.sub).toBe('77776025198584418');
    expect(user.roles).toEqual(['front_desk']);
    expect(user.propertyIds).toEqual([PROPERTY]);
  });

  it('refuses a token whose aud lacks the project', async () => {
    const rest: Record<string, unknown> = zitadelPayload();
    delete rest.aud;
    await expect(service().verify(sign(rest, { audience: ['another-project'] }))).rejects.toThrow(
      /audience/i,
    );
  });

  it('refuses a token from another issuer', async () => {
    const { aud, ...rest } = zitadelPayload();
    await expect(
      service().verify(sign(rest, { audience: aud, issuer: 'https://evil.example.com' })),
    ).rejects.toThrow(/issuer/i);
  });

  it('refuses an azp outside an explicit allow-list', async () => {
    const { aud, ...rest } = zitadelPayload();
    await expect(
      service({ KEYCLOAK_ALLOWED_AZP: 'haip-dashboard' }).verify(sign(rest, { audience: aud })),
    ).rejects.toThrow(/azp/);
  });
});
