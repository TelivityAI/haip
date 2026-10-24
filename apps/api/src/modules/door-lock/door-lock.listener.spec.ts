import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DoorLockListener } from './door-lock.listener';
import type { WebhookPayload } from '../webhook/webhook.service';

const PROPERTY_ID = '44444444-4444-4444-4444-444444444444';
const RESERVATION_ID = '55555555-5555-5555-5555-555555555555';

function payload(event: string, data: Record<string, unknown> = {}): WebhookPayload {
  return {
    event,
    entityType: 'reservation',
    entityId: RESERVATION_ID,
    propertyId: PROPERTY_ID,
    data,
    timestamp: new Date().toISOString(),
  };
}

describe('DoorLockListener', () => {
  let lock: { issueCredential: ReturnType<typeof vi.fn>; revokeCredential: ReturnType<typeof vi.fn> };
  let factory: { resolveForProperty: ReturnType<typeof vi.fn> };
  let listener: DoorLockListener;

  const db = {
    select: vi.fn(),
  };

  beforeEach(() => {
    lock = {
      issueCredential: vi.fn().mockResolvedValue({
        provider: 'webhook',
        credentialId: 'x',
        accessCode: '000000',
      }),
      revokeCredential: vi.fn().mockResolvedValue(undefined),
    };
    factory = {
      resolveForProperty: vi.fn().mockReturnValue(lock),
    };
    db.select.mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ settings: { onlineCheckIn: { lockProvider: 'nuki' } } }]),
      }),
    }));
    // First select = property, second = room (when roomId present)
    let call = 0;
    db.select.mockImplementation(() => {
      call += 1;
      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(
            call === 1
              ? [{ settings: { onlineCheckIn: { lockProvider: 'nuki' } } }]
              : [{ externalLockId: 'lock-42' }],
          ),
        }),
      };
    });
    listener = new DoorLockListener(factory as any, db as any);
  });

  it('provisions access on check-in with property provider and room lock id', async () => {
    await listener.onCheckIn(payload('reservation.checked_in', { roomId: 'room-9' }));
    expect(factory.resolveForProperty).toHaveBeenCalledWith('nuki');
    expect(lock.issueCredential).toHaveBeenCalledWith({
      propertyId: PROPERTY_ID,
      reservationId: RESERVATION_ID,
      roomId: 'room-9',
      externalLockId: 'lock-42',
    });
  });

  it('revokes access on check-out', async () => {
    await listener.onCheckOut(payload('reservation.checked_out', { roomId: 'room-9' }));
    expect(lock.revokeCredential).toHaveBeenCalledWith(
      expect.objectContaining({
        propertyId: PROPERTY_ID,
        reservationId: RESERVATION_ID,
        roomId: 'room-9',
      }),
    );
  });

  it('never throws when the lock vendor fails', async () => {
    lock.issueCredential.mockRejectedValueOnce(new Error('vendor down'));
    await expect(listener.onCheckIn(payload('reservation.checked_in'))).resolves.toBeUndefined();
  });
});
