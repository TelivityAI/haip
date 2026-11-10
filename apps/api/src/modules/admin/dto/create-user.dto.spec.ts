import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';

import { CreateUserDto } from './create-user.dto';

const base = {
  propertyId: 'a0000001-0000-4000-a000-000000000001',
  email: 'anna@grandhotel.com',
  name: 'Anna Front Desk',
};

describe('CreateUserDto.keycloakSub', () => {
  const run = (keycloakSub: string | undefined) =>
    validate(plainToInstance(CreateUserDto, { ...base, keycloakSub }));

  it('accepts Keycloak UUIDs and non-UUID OIDC subjects (same as isValidKeycloakSub)', async () => {
    for (const sub of [
      'a0000001-0000-4000-a000-000000000001',
      '77776025198584418',
      'auth0|5f7c8ec7c33c6c004bbafe82',
    ]) {
      expect(await run(sub), sub).toEqual([]);
    }
  });

  it('refuses empty, whitespace and over-long subjects', async () => {
    for (const sub of ['', 'has space', ' 7777602519858441', 'x'.repeat(256)]) {
      const errors = await run(sub);
      expect(errors.some((e) => e.property === 'keycloakSub'), sub).toBe(true);
    }
  });

  it('omitting keycloakSub stays valid (optional)', async () => {
    expect(await run(undefined)).toEqual([]);
  });
});
