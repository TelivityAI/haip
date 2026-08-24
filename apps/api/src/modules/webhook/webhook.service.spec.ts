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

  it('rejects a persisted dispatch name outside the shared WebhookEvent catalog', async () => {
    const eventEmitter = { emitAsync: vi.fn().mockResolvedValue([]) };
    const service = new WebhookService(
      { insert: vi.fn() } as unknown as ConstructorParameters<typeof WebhookService>[0],
      eventEmitter as unknown as ConstructorParameters<typeof WebhookService>[1],
    );
    const payload = {
      event: 'payment.retained',
      entityType: 'booking_request_payment_resolution',
      entityId: 'bbbbbbbb-0000-4000-a000-000000000001',
      data: {},
      timestamp: '2026-08-25T00:00:00.000Z',
    } as unknown as WebhookPayload;

    await expect(service.dispatchPersisted(payload, 'logical-event-1'))
      .rejects.toThrow(/unknown persisted webhook event/i);
    expect(eventEmitter.emitAsync).not.toHaveBeenCalled();
  });
});
