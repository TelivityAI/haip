import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SaltoKsLockProvider } from './salto-ks-lock.provider';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const PROPERTY_ID = '44444444-4444-4444-4444-444444444444';
const RESERVATION_ID = '55555555-5555-5555-5555-555555555555';

describe('SaltoKsLockProvider', () => {
  const env = { ...process.env };

  beforeEach(() => {
    mockFetch.mockReset();
    process.env['SALTO_KS_CLIENT_ID'] = 'cid';
    process.env['SALTO_KS_CLIENT_SECRET'] = 'secret';
    process.env['SALTO_KS_SITE_ID'] = 'site-1';
  });

  afterEach(() => {
    process.env = { ...env };
  });

  it('reports not configured without site id', () => {
    delete process.env['SALTO_KS_SITE_ID'];
    const provider = new SaltoKsLockProvider({} as any);
    expect(provider.isConfigured()).toBe(false);
  });

  it('creates site user after OAuth token', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'tok', expires_in: 3600 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'user-abc' }),
      });

    const credentials = {
      recordIssued: vi.fn().mockResolvedValue(undefined),
      recordRevoked: vi.fn(),
      findByReservation: vi.fn(),
    };
    const provider = new SaltoKsLockProvider(credentials as any);

    const cred = await provider.issueCredential({
      propertyId: PROPERTY_ID,
      reservationId: RESERVATION_ID,
    });

    expect(cred.provider).toBe('salto_ks');
    expect(cred.credentialId).toBe('user-abc');
    expect(String(mockFetch.mock.calls[1][0])).toContain('/sites/site-1/users');
    expect(credentials.recordIssued).toHaveBeenCalled();
  });
});
