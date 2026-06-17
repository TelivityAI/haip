import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { ApiKeyGuard, hashConnectKey } from './api-key.guard';

function ctx(req: any) {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as any;
}

describe('ApiKeyGuard', () => {
  let config: any;
  let db: any;
  let guard: ApiKeyGuard;

  beforeEach(() => {
    config = { get: vi.fn().mockReturnValue('true') }; // AUTH_ENABLED=true
    db = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      }),
    };
    guard = new ApiKeyGuard(config, db);
  });

  it('AUTH_ENABLED=false → no-op allow, attaches platform principal', async () => {
    config.get.mockReturnValue('false');
    const req: any = { headers: {} };
    await expect(guard.canActivate(ctx(req))).resolves.toBe(true);
    expect(req.connect).toEqual({ scope: 'platform' });
  });

  it('rejects when no x-api-key header is provided', async () => {
    const req = { headers: {} };
    await expect(guard.canActivate(ctx(req))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('attaches scope=property when key matches a connect_credentials row', async () => {
    const raw = 'rk_secret_AAA';
    const cred = {
      id: 'cred-1',
      propertyId: 'prop-A',
      keyHash: hashConnectKey(raw),
      isActive: true,
      revokedAt: null,
    };
    db.select.mockReturnValue({
      from: () => ({ where: () => Promise.resolve([cred]) }),
    });
    const req: any = { headers: { 'x-api-key': raw } };
    await expect(guard.canActivate(ctx(req))).resolves.toBe(true);
    expect(req.connect).toEqual({ scope: 'property', propertyId: 'prop-A', credentialId: 'cred-1' });
  });

  it('TERMINAL-rejects a revoked credential — env fallback must NOT reauthorize as platform', async () => {
    // The footgun Codex flagged: a revoked per-property key whose RAW value also
    // happens to equal CONNECT_API_KEY used to silently re-auth as platform. It
    // must now fail hard regardless of env.
    const raw = 'rk_revoked_and_also_in_env';
    db.select.mockReturnValue({
      from: () => ({
        where: () =>
          Promise.resolve([
            {
              id: 'cred-r',
              propertyId: 'prop-A',
              keyHash: hashConnectKey(raw),
              isActive: true,
              revokedAt: new Date(),
            },
          ]),
      }),
    });
    config.get = vi.fn().mockImplementation((k: string, def?: string) =>
      k === 'AUTH_ENABLED' ? 'true' : k === 'CONNECT_API_KEY' ? raw : def,
    );
    const req: any = { headers: { 'x-api-key': raw } };
    await expect(guard.canActivate(ctx(req))).rejects.toBeInstanceOf(UnauthorizedException);
    expect(req.connect).toBeUndefined();
  });

  it('TERMINAL-rejects an inactive (isActive=false) credential — env fallback must NOT reauthorize', async () => {
    const raw = 'rk_inactive';
    db.select.mockReturnValue({
      from: () => ({
        where: () =>
          Promise.resolve([
            {
              id: 'cred-i',
              propertyId: 'prop-A',
              keyHash: hashConnectKey(raw),
              isActive: false,
              revokedAt: null,
            },
          ]),
      }),
    });
    config.get = vi.fn().mockImplementation((k: string, def?: string) =>
      k === 'AUTH_ENABLED' ? 'true' : k === 'CONNECT_API_KEY' ? raw : def,
    );
    const req: any = { headers: { 'x-api-key': raw } };
    await expect(guard.canActivate(ctx(req))).rejects.toBeInstanceOf(UnauthorizedException);
    expect(req.connect).toBeUndefined();
  });

  it('falls back to CONNECT_API_KEY (platform) when no DB row matches', async () => {
    config.get = vi.fn().mockImplementation((k: string, def?: string) =>
      k === 'AUTH_ENABLED' ? 'true' : k === 'CONNECT_API_KEY' ? 'platform-key-xyz' : def,
    );
    const req: any = { headers: { 'x-api-key': 'platform-key-xyz' } };
    await expect(guard.canActivate(ctx(req))).resolves.toBe(true);
    expect(req.connect).toEqual({ scope: 'platform' });
  });

  it('rejects an unknown key (no DB row, no env match)', async () => {
    config.get = vi.fn().mockImplementation((k: string, def?: string) =>
      k === 'AUTH_ENABLED' ? 'true' : k === 'CONNECT_API_KEY' ? 'platform-key-xyz' : def,
    );
    const req: any = { headers: { 'x-api-key': 'totally-wrong' } };
    await expect(guard.canActivate(ctx(req))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects when DB has no match and CONNECT_API_KEY env is unset (fail closed)', async () => {
    config.get = vi.fn().mockImplementation((k: string, def?: string) =>
      k === 'AUTH_ENABLED' ? 'true' : k === 'CONNECT_API_KEY' ? undefined : def,
    );
    const req: any = { headers: { 'x-api-key': 'anything' } };
    await expect(guard.canActivate(ctx(req))).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
