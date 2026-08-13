import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';

import { JwtStrategy } from './jwt.strategy';

/**
 * The azp allow-list. `azp` is immutably the client that obtained the token,
 * so a second realm client (a service account integrating over the public
 * API) can never satisfy a single-value equality no matter what audience
 * mappers it carries. KEYCLOAK_ALLOWED_AZP names the clients allowed to call;
 * unset, behaviour is exactly the old one — only the primary client passes.
 */
function strategy(env: Record<string, string>): JwtStrategy {
  const config = new ConfigService(env);
  return new JwtStrategy(config as any);
}

const BASE = {
  KEYCLOAK_URL: 'http://keycloak.test',
  KEYCLOAK_REALM: 'haip',
  KEYCLOAK_CLIENT_ID: 'haip-dashboard',
};

const payload = (azp?: string) => ({
  sub: 'user-1',
  azp,
  realm_access: { roles: ['admin'] },
});

describe('azp allow-list', () => {
  it('unset: only the primary client passes (the old behaviour, unchanged)', () => {
    const s = strategy(BASE);
    expect(s.validate(payload('haip-dashboard')).sub).toBe('user-1');
    expect(() => s.validate(payload('enquiry-service'))).toThrow(UnauthorizedException);
  });

  it('set: every listed client passes, anything else still fails', () => {
    const s = strategy({ ...BASE, KEYCLOAK_ALLOWED_AZP: 'haip-dashboard, enquiry-service' });
    expect(s.validate(payload('haip-dashboard')).sub).toBe('user-1');
    expect(s.validate(payload('enquiry-service')).sub).toBe('user-1');
    expect(() => s.validate(payload('some-other-client'))).toThrow(UnauthorizedException);
  });

  it('a token with no azp is not rejected by this check (unchanged)', () => {
    const s = strategy({ ...BASE, KEYCLOAK_ALLOWED_AZP: 'haip-dashboard' });
    expect(s.validate(payload(undefined)).sub).toBe('user-1');
  });

  it('the list does not widen aud: KEYCLOAK_AUDIENCE stays single-valued', () => {
    // The allow-list applies to azp only. Passport's audience check above this
    // layer still requires the single configured audience, which callers add
    // via an audience mapper — the two mechanisms stay separate on purpose.
    const s = strategy({
      ...BASE,
      KEYCLOAK_AUDIENCE: 'haip-dashboard',
      KEYCLOAK_ALLOWED_AZP: 'haip-dashboard,enquiry-service',
    });
    expect(s.validate(payload('enquiry-service')).sub).toBe('user-1');
  });
});
