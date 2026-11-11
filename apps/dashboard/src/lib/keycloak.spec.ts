import { describe, expect, it } from 'vitest';

import { tokenRoles } from './keycloak';

const PROPERTY = 'a0000001-0000-4000-a000-000000000001';
const PROJECT = '345678901234567890';

describe('tokenRoles', () => {
  it('reads Keycloak realm_access.roles and strips property grants', () => {
    expect(
      tokenRoles({
        realm_access: { roles: ['front_desk', `property:${PROPERTY}`] },
      }),
    ).toEqual(['front_desk']);
  });

  it('reads the generic Zitadel project-roles claim', () => {
    expect(
      tokenRoles({
        'urn:zitadel:iam:org:project:roles': {
          admin: {},
          [`property:${PROPERTY}`]: {},
        },
      }),
    ).toEqual(['admin']);
  });

  it('falls back to the per-audience Zitadel claim when the generic one is absent', () => {
    expect(
      tokenRoles({
        aud: [PROJECT, 'other'],
        [`urn:zitadel:iam:org:project:${PROJECT}:roles`]: {
          front_desk: { '111': 'scds.localhost' },
          [`property:${PROPERTY}`]: { '111': 'scds.localhost' },
        },
      }),
    ).toEqual(['front_desk']);
  });

  it('reads a flat roles array (Entra-style)', () => {
    expect(tokenRoles({ roles: ['readonly', `property:${PROPERTY}`] })).toEqual(['readonly']);
  });

  it('returns no roles when none of the claim shapes are present', () => {
    expect(tokenRoles({ sub: 'x' })).toEqual([]);
    expect(tokenRoles(undefined)).toEqual([]);
  });
});
