import { describe, it, expect } from 'vitest';
import { UnauthorizedException, InternalServerErrorException, type ExecutionContext } from '@nestjs/common';
import { ApiKeyGuard } from './api-key.guard';

function ctx(apiKey?: string): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers: apiKey ? { 'x-api-key': apiKey } : {} }) }),
  } as unknown as ExecutionContext;
}

function guard(env: Record<string, string | undefined>) {
  const cfg = { get: (k: string, d?: string) => env[k] ?? d } as any;
  return new ApiKeyGuard(cfg);
}

describe('ApiKeyGuard', () => {
  it('bypasses when AUTH_ENABLED=false', () => {
    expect(guard({ AUTH_ENABLED: 'false' }).canActivate(ctx())).toBe(true);
  });

  it('fails closed when no key is configured', () => {
    expect(() => guard({ AUTH_ENABLED: 'true', CONNECT_API_KEY: '' }).canActivate(ctx('x'))).toThrow(
      InternalServerErrorException,
    );
  });

  it('accepts a valid key (constant-time compare)', () => {
    expect(guard({ AUTH_ENABLED: 'true', CONNECT_API_KEY: 'k1,k2' }).canActivate(ctx('k2'))).toBe(true);
  });

  it('rejects an invalid or missing key', () => {
    const g = guard({ AUTH_ENABLED: 'true', CONNECT_API_KEY: 'k1' });
    expect(() => g.canActivate(ctx('nope'))).toThrow(UnauthorizedException);
    expect(() => g.canActivate(ctx())).toThrow(UnauthorizedException);
  });
});
