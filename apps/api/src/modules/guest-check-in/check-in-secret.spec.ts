import { describe, expect, it } from 'vitest';
import { InternalServerErrorException } from '@nestjs/common';
import { resolveCheckInMagicSecret } from './check-in-secret';

function config(values: Record<string, string | undefined>) {
  return { get: (key: string) => values[key] } as any;
}

describe('resolveCheckInMagicSecret', () => {
  it('uses CHECK_IN_MAGIC_SECRET when set', () => {
    expect(
      resolveCheckInMagicSecret(
        config({ CHECK_IN_MAGIC_SECRET: 'prod-secret', NODE_ENV: 'production' }),
      ),
    ).toBe('prod-secret');
  });

  it('falls back to JWT_SECRET in development', () => {
    expect(
      resolveCheckInMagicSecret(config({ JWT_SECRET: 'jwt-sec', NODE_ENV: 'development' })),
    ).toBe('jwt-sec');
  });

  it('fails closed in production when secret is missing', () => {
    expect(() =>
      resolveCheckInMagicSecret(config({ NODE_ENV: 'production' })),
    ).toThrow(InternalServerErrorException);
  });

  it('fails closed in production when secret is the dev placeholder', () => {
    expect(() =>
      resolveCheckInMagicSecret(
        config({
          CHECK_IN_MAGIC_SECRET: 'dev-check-in-secret-change-me',
          NODE_ENV: 'production',
        }),
      ),
    ).toThrow(InternalServerErrorException);
  });

  it('allows the dev placeholder outside production', () => {
    expect(
      resolveCheckInMagicSecret(
        config({ NODE_ENV: 'development' }),
      ),
    ).toBe('dev-check-in-secret-change-me');
  });
});
