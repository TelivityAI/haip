import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TtlockLockProvider } from './ttlock-lock.provider';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const PROPERTY_ID = '44444444-4444-4444-4444-444444444444';
const RESERVATION_ID = '55555555-5555-5555-5555-555555555555';

describe('TtlockLockProvider', () => {
  const env = { ...process.env };

  beforeEach(() => {
    mockFetch.mockReset();
    process.env['TTLOCK_CLIENT_ID'] = 'cid';
    process.env['TTLOCK_CLIENT_SECRET'] = 'secret';
    process.env['TTLOCK_USERNAME'] = 'user';
    process.env['TTLOCK_PASSWORD'] = 'pass';
    process.env['TTLOCK_LOCK_ID'] = '100';
  });

  afterEach(() => {
    process.env = { ...env };
  });

  it('reports not configured when env is incomplete', () => {
    delete process.env['TTLOCK_LOCK_ID'];
    const provider = new TtlockLockProvider({} as any);
    expect(provider.isConfigured()).toBe(false);
  });

  it('obtains token and adds keyboard PIN', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'tok', expires_in: 3600 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ keyboardPwdId: 7 }),
      });

    const credentials = {
      recordIssued: vi.fn().mockResolvedValue(undefined),
      recordRevoked: vi.fn(),
      findByReservation: vi.fn(),
    };
    const provider = new TtlockLockProvider(credentials as any);

    const cred = await provider.issueCredential({
      propertyId: PROPERTY_ID,
      reservationId: RESERVATION_ID,
    });

    expect(cred.credentialId).toBe('7');
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(String(mockFetch.mock.calls[1][0])).toContain('keyboardPwd/add');
    expect(credentials.recordIssued).toHaveBeenCalled();
  });
});
