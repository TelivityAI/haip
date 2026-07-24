import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NukiLockProvider } from './nuki-lock.provider';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const PROPERTY_ID = '44444444-4444-4444-4444-444444444444';
const RESERVATION_ID = '55555555-5555-5555-5555-555555555555';

describe('NukiLockProvider', () => {
  const env = { ...process.env };

  beforeEach(() => {
    mockFetch.mockReset();
    process.env['NUKI_API_TOKEN'] = 'token';
    process.env['NUKI_SMARTLOCK_ID'] = 'lock-1';
  });

  afterEach(() => {
    process.env = { ...env };
  });

  it('reports not configured without credentials', () => {
    delete process.env['NUKI_API_TOKEN'];
    const provider = new NukiLockProvider({} as any);
    expect(provider.isConfigured()).toBe(false);
  });

  it('creates Nuki auth and records credential', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 42 }),
    });

    const credentials = {
      recordIssued: vi.fn().mockResolvedValue(undefined),
      recordRevoked: vi.fn(),
      findByReservation: vi.fn(),
    };
    const provider = new NukiLockProvider(credentials as any);

    const cred = await provider.issueCredential({
      propertyId: PROPERTY_ID,
      reservationId: RESERVATION_ID,
    });

    expect(cred.provider).toBe('nuki');
    expect(cred.credentialId).toBe('42');
    expect(mockFetch.mock.calls[0][0]).toContain('/smartlock/lock-1/auth');
    expect(credentials.recordIssued).toHaveBeenCalled();
  });

  it('deletes Nuki auth on revoke', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });
    const credentials = {
      recordIssued: vi.fn(),
      recordRevoked: vi.fn(),
      findByReservation: vi.fn().mockResolvedValue({ credentialId: '99' }),
    };
    const provider = new NukiLockProvider(credentials as any);

    await provider.revokeCredential({
      propertyId: PROPERTY_ID,
      reservationId: RESERVATION_ID,
    });

    expect(mockFetch.mock.calls[0][0]).toContain('/auth/99');
    expect(credentials.recordRevoked).toHaveBeenCalledWith(PROPERTY_ID, RESERVATION_ID);
  });
});
