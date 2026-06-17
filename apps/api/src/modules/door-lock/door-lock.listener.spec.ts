import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DoorLockListener } from './door-lock.listener';
import { WebhookLockProvider } from './providers/webhook-lock.provider';
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
  let listener: DoorLockListener;

  beforeEach(() => {
    lock = {
      issueCredential: vi.fn().mockResolvedValue({ provider: 'webhook', credentialId: 'x', accessCode: '000000' }),
      revokeCredential: vi.fn().mockResolvedValue(undefined),
    };
    listener = new DoorLockListener(lock as any);
  });

  it('provisions access on check-in, scoped to the property and room', async () => {
    await listener.onCheckIn(payload('reservation.checked_in', { roomId: 'room-9' }));
    expect(lock.issueCredential).toHaveBeenCalledWith({
      propertyId: PROPERTY_ID,
      reservationId: RESERVATION_ID,
      roomId: 'room-9',
    });
  });

  it('revokes access on check-out', async () => {
    await listener.onCheckOut(payload('reservation.checked_out', { roomId: 'room-9' }));
    expect(lock.revokeCredential).toHaveBeenCalledWith({
      propertyId: PROPERTY_ID,
      reservationId: RESERVATION_ID,
      roomId: 'room-9',
    });
  });

  it('never throws when the lock vendor fails (check-in must not break)', async () => {
    lock.issueCredential.mockRejectedValueOnce(new Error('vendor down'));
    await expect(listener.onCheckIn(payload('reservation.checked_in'))).resolves.toBeUndefined();
  });
});

describe('WebhookLockProvider', () => {
  it('emits door.access_granted with a CSPRNG 6-digit PIN', async () => {
    const webhooks = { emit: vi.fn().mockResolvedValue(undefined) };
    const provider = new WebhookLockProvider(webhooks as any);

    const cred = await provider.issueCredential({ propertyId: PROPERTY_ID, reservationId: RESERVATION_ID, roomId: 'r1' });

    expect(cred.accessCode).toMatch(/^\d{6}$/);
    const [event, , , data, propertyId] = webhooks.emit.mock.calls[0];
    expect(event).toBe('door.access_granted');
    expect(propertyId).toBe(PROPERTY_ID);
    expect(data).toMatchObject({ roomId: 'r1', provider: 'webhook' });
  });
});
