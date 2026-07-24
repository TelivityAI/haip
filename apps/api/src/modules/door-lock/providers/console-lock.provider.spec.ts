import { describe, it, expect, vi } from 'vitest';
import { ConsoleLockProvider } from './console-lock.provider';

const PROPERTY_ID = '44444444-4444-4444-4444-444444444444';
const RESERVATION_ID = '55555555-5555-5555-5555-555555555555';

describe('ConsoleLockProvider', () => {
  it('issues a CSPRNG PIN and persists credential', async () => {
    const credentials = {
      recordIssued: vi.fn().mockResolvedValue({ id: 'cred-1' }),
      recordRevoked: vi.fn(),
    };
    const provider = new ConsoleLockProvider(credentials as any);

    const cred = await provider.issueCredential({
      propertyId: PROPERTY_ID,
      reservationId: RESERVATION_ID,
      roomId: 'room-1',
    });

    expect(provider.isConfigured()).toBe(true);
    expect(cred.provider).toBe('console');
    expect(cred.accessCode).toMatch(/^\d{6}$/);
    expect(credentials.recordIssued).toHaveBeenCalled();
  });

  it('revokes and updates credential row', async () => {
    const credentials = {
      recordIssued: vi.fn(),
      recordRevoked: vi.fn().mockResolvedValue({ status: 'revoked' }),
    };
    const provider = new ConsoleLockProvider(credentials as any);

    await provider.revokeCredential({
      propertyId: PROPERTY_ID,
      reservationId: RESERVATION_ID,
    });

    expect(credentials.recordRevoked).toHaveBeenCalledWith(PROPERTY_ID, RESERVATION_ID);
  });
});
