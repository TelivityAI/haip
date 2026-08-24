import { describe, expect, it, vi } from 'vitest';
import { WebhookService, type WebhookPayload } from './webhook.service';

describe('WebhookService persisted dispatch', () => {
  it('adds the stable logical event ID only to the internal dispatch envelope', async () => {
    const db = { insert: vi.fn() };
    const eventEmitter = { emitAsync: vi.fn().mockResolvedValue([]) };
    const service = new WebhookService(
      db as unknown as ConstructorParameters<typeof WebhookService>[0],
      eventEmitter as unknown as ConstructorParameters<typeof WebhookService>[1],
    );
    const payload: WebhookPayload = {
      event: 'booking_request.created',
      entityType: 'booking_request',
      entityId: 'bbbbbbbb-0000-4000-a000-000000000001',
      propertyId: 'aaaaaaaa-0000-4000-a000-000000000001',
      data: {
        requestId: 'bbbbbbbb-0000-4000-a000-000000000001',
        status: 'pending',
      },
      timestamp: '2026-08-24T17:15:00.000Z',
    };

    await service.dispatchPersisted(
      payload,
      'bbbbbbbb-0000-4000-a000-000000000002',
    );

    expect(eventEmitter.emitAsync).toHaveBeenCalledWith(
      'booking_request.created',
      {
        ...payload,
        logicalEventId: 'bbbbbbbb-0000-4000-a000-000000000002',
      },
    );
    expect(payload).not.toHaveProperty('logicalEventId');
    expect(db.insert).not.toHaveBeenCalled();
  });
});
