import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { NukiLockProvider } from './nuki-lock.provider';

describe('NukiLockProvider externalLockId', () => {
  const credentials = {
    recordIssued: vi.fn(),
    findByReservation: vi.fn(),
    markRevoked: vi.fn(),
  };

  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: 99 }),
        text: async () => '',
      }),
    );
    process.env['NUKI_API_TOKEN'] = 'tok';
    delete process.env['NUKI_SMARTLOCK_ID'];
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env['NUKI_API_TOKEN'];
    delete process.env['NUKI_SMARTLOCK_ID'];
  });

  it('is configured with API token alone (per-room lock ids)', () => {
    const provider = new NukiLockProvider(credentials as any);
    expect(provider.isConfigured()).toBe(true);
  });

  it('issues against room.externalLockId', async () => {
    const provider = new NukiLockProvider(credentials as any);
    await provider.issueCredential({
      propertyId: 'p1',
      reservationId: 'r1',
      roomId: 'room-1',
      externalLockId: 'lock-room-7',
    });
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/smartlock/lock-room-7/auth'),
      expect.any(Object),
    );
  });

  it('falls back to NUKI_SMARTLOCK_ID when room has no externalLockId', async () => {
    process.env['NUKI_SMARTLOCK_ID'] = 'env-lock';
    const provider = new NukiLockProvider(credentials as any);
    await provider.issueCredential({
      propertyId: 'p1',
      reservationId: 'r1',
      externalLockId: null,
    });
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/smartlock/env-lock/auth'),
      expect.any(Object),
    );
  });

  it('throws when neither room nor env lock id is set', async () => {
    const provider = new NukiLockProvider(credentials as any);
    await expect(
      provider.issueCredential({
        propertyId: 'p1',
        reservationId: 'r1',
        externalLockId: null,
      }),
    ).rejects.toThrow(/externalLockId or NUKI_SMARTLOCK_ID/);
  });
});
