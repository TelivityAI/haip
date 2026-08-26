import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'crypto';
import { WebhookDeliveryService } from './webhook-delivery.service';
import { assertSafeOutboundUrl } from '../../common/security/url-guard';

// The SSRF URL guard does real DNS resolution (covered by its own spec); stub it
// here so these tests exercise delivery logic without network.
vi.mock('../../common/security/url-guard', () => ({
  assertSafeOutboundUrl: vi.fn().mockResolvedValue(undefined),
}));

/**
 * Stateful mock DB that stores webhook_deliveries in memory so the service's
 * read-modify-write cycle actually works. Subscriptions are handed back from
 * a lookup map. Only the fields the service actually uses are modelled.
 */
function createStatefulMockDb(subscription: any) {
  const deliveries = new Map<string, any>();
  let idCounter = 1;

  // Single-table lookup by probing call args — Drizzle operators return opaque
  // objects, so fall back to deliveries when table metadata is unavailable.
  const fallbackTable: 'webhook_deliveries' | 'subscriptions' = 'webhook_deliveries';

  const identifyTable = (tbl: any): 'webhook_deliveries' | 'subscriptions' => {
    // @telivityhaip/database exports identifiable symbols on each pgTable. Fall back
    // to a constructor-name check; the test just needs to distinguish.
    const name = tbl?.[Symbol.for('drizzle:Name')] ?? tbl?._?.name ?? '';
    if (String(name).includes('webhook_deliveries')) return 'webhook_deliveries';
    if (String(name).includes('agent_webhook_subscriptions')) return 'subscriptions';
    return fallbackTable;
  };

  return {
    _deliveries: deliveries,
    select: vi.fn((_arg?: any) => {
      // select() with no arg = full row; from() dispatches by table.
      return {
        from: vi.fn((tbl: any) => {
          const tableId = identifyTable(tbl);
          return {
            where: vi.fn(() => {
              if (tableId === 'subscriptions') {
                return Promise.resolve([subscription]);
              }
              return Promise.resolve(Array.from(deliveries.values()));
            }),
            limit: vi.fn(() => Promise.resolve(Array.from(deliveries.values()))),
          };
        }),
      };
    }),
    insert: vi.fn((_tbl: any) => ({
      values: vi.fn((vals: any) => {
        const insertOnce = () => {
          const existing = vals.logicalEventId
            ? Array.from(deliveries.values()).find((row) =>
              row.propertyId === vals.propertyId
              && row.subscriptionId === vals.subscriptionId
              && row.logicalEventId === vals.logicalEventId)
            : undefined;
          if (existing) return Promise.resolve([]);
          const id = `del-${idCounter++}`;
          const row = { id, ...vals };
          deliveries.set(id, row);
          return Promise.resolve([row]);
        };
        return {
          returning: vi.fn(insertOnce),
          onConflictDoNothing: vi.fn(() => ({
            returning: vi.fn(insertOnce),
          })),
        };
      }),
    })),
    update: vi.fn((_tbl: any) => ({
      set: vi.fn((vals: any) => ({
        where: vi.fn(() => {
          // Without parsing the eq() operator, we apply the update to the
          // most recent delivery row (tests only touch one at a time).
          const last = Array.from(deliveries.values()).pop();
          if (last) Object.assign(last, vals);
          return Promise.resolve();
        }),
      })),
    })),
  };
}

describe('WebhookDeliveryService', () => {
  const subscription = {
    id: 'sub-1',
    propertyId: 'prop-1',
    callbackUrl: 'https://hooks.test/endpoint',
    secret: 'super-secret',
    isActive: true,
    failureCount: 0,
  };

  const payload = {
    eventType: 'reservation.created',
    propertyId: 'prop-1',
    entityType: 'reservation',
    entityId: 'res-1',
    data: { foo: 'bar' },
    timestamp: new Date().toISOString(),
  };

  let fetchMock: ReturnType<typeof vi.fn>;
  const originalEnv = process.env['NODE_ENV'];

  const createMockQueue = () => ({
    add: vi.fn().mockResolvedValue({ id: 'job-1' }),
    close: vi.fn().mockResolvedValue(undefined),
  });

  beforeEach(() => {
    process.env['NODE_ENV'] = 'test';
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as any;
    vi.mocked(assertSafeOutboundUrl).mockResolvedValue(undefined);
  });

  afterEach(() => {
    process.env['NODE_ENV'] = originalEnv;
    vi.clearAllMocks();
  });

  it('enqueues a delivery row and durable BullMQ job without in-process POST', async () => {
    const db = createStatefulMockDb(subscription);
    const queue = createMockQueue();
    const service = new WebhookDeliveryService(db as any, undefined, queue as any);

    const delivery = await service.enqueue(payload, subscription.id);

    expect(queue.add).toHaveBeenCalledWith(
      'deliver-webhook',
      { deliveryId: delivery.id, propertyId: 'prop-1' },
      expect.objectContaining({
        jobId: delivery.id,
        attempts: 5,
        backoff: { type: 'exponential', delay: 30_000 },
      }),
    );
    expect(fetchMock).not.toHaveBeenCalled();

    const stored = db._deliveries.get(delivery.id);
    expect(stored.status).toBe('pending');
    expect(stored.attempts).toBe(0);
  });

  it('uses the delivery row ID as the event header for legacy events', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    const db = createStatefulMockDb(subscription);
    const queue = createMockQueue();
    const service = new WebhookDeliveryService(db as any, undefined, queue as any);

    const delivery = await service.enqueue(payload, subscription.id);
    await service.processDeliveryJob({ deliveryId: delivery.id, propertyId: 'prop-1' });

    expect(assertSafeOutboundUrl).toHaveBeenCalledWith('https://hooks.test/endpoint', {
      requireHttps: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://hooks.test/endpoint');
    expect(init.method).toBe('POST');

    const body = init.body as string;
    const expectedSig = `sha256=${createHmac('sha256', subscription.secret).update(body).digest('hex')}`;
    expect(init.headers['X-HAIP-Signature']).toBe(expectedSig);
    expect(init.headers['X-HAIP-Event-Id']).toBe(delivery.id);
    expect(init.headers['X-HAIP-Event-Type']).toBe('reservation.created');
    expect(init.headers['Content-Type']).toBe('application/json');

    // Row should be marked delivered.
    const stored = db._deliveries.get(delivery.id);
    expect(stored.status).toBe('delivered');
    expect(stored.attempts).toBe(1);
  });

  it('reuses one persisted delivery and stable header across event replay', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({ ok: true, status: 200 });
    const db = createStatefulMockDb(subscription);
    const queue = createMockQueue();
    const service = new WebhookDeliveryService(
      db as unknown as ConstructorParameters<typeof WebhookDeliveryService>[0],
      undefined,
      queue as unknown as ConstructorParameters<typeof WebhookDeliveryService>[2],
    );
    const logicalEventId = 'bbbbbbbb-0000-4000-a000-000000000002';

    const first = await service.enqueue(payload, subscription.id, logicalEventId);
    const replay = await service.enqueue(payload, subscription.id, logicalEventId);

    expect(replay.id).toBe(first.id);
    expect(db._deliveries.size).toBe(1);
    expect(db._deliveries.get(first.id).logicalEventId).toBe(logicalEventId);
    expect(queue.add).toHaveBeenCalledTimes(2);
    expect(queue.add.mock.calls.map((call) => call[2]?.jobId)).toEqual([
      first.id,
      first.id,
    ]);

    await expect(
      service.processDeliveryJob({ deliveryId: first.id, propertyId: 'prop-1' }),
    ).rejects.toThrow('scheduled for retry');
    await service.processDeliveryJob({ deliveryId: first.id, propertyId: 'prop-1' });
    await service.processDeliveryJob({ deliveryId: replay.id, propertyId: 'prop-1' });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map((call) =>
      call[1].headers['X-HAIP-Event-Id'])).toEqual([
      logicalEventId,
      logicalEventId,
    ]);
  });

  it('creates separate deliveries for different persisted logical events', async () => {
    const db = createStatefulMockDb(subscription);
    const queue = createMockQueue();
    const service = new WebhookDeliveryService(
      db as unknown as ConstructorParameters<typeof WebhookDeliveryService>[0],
      undefined,
      queue as unknown as ConstructorParameters<typeof WebhookDeliveryService>[2],
    );

    const first = await service.enqueue(
      payload,
      subscription.id,
      'bbbbbbbb-0000-4000-a000-000000000002',
    );
    const second = await service.enqueue(
      payload,
      subscription.id,
      'bbbbbbbb-0000-4000-a000-000000000003',
    );

    expect(second.id).not.toBe(first.id);
    expect(db._deliveries.size).toBe(2);
    expect(Array.from(db._deliveries.values()).map((row) => row.logicalEventId)).toEqual([
      'bbbbbbbb-0000-4000-a000-000000000002',
      'bbbbbbbb-0000-4000-a000-000000000003',
    ]);
  });

  it('returns the same delivery from concurrent persisted event creation', async () => {
    const db = createStatefulMockDb(subscription);
    const queue = createMockQueue();
    const service = new WebhookDeliveryService(
      db as unknown as ConstructorParameters<typeof WebhookDeliveryService>[0],
      undefined,
      queue as unknown as ConstructorParameters<typeof WebhookDeliveryService>[2],
    );
    const logicalEventId = 'bbbbbbbb-0000-4000-a000-000000000002';

    const [first, replay] = await Promise.all([
      service.enqueue(payload, subscription.id, logicalEventId),
      service.enqueue(payload, subscription.id, logicalEventId),
    ]);

    expect(replay.id).toBe(first.id);
    expect(db._deliveries.size).toBe(1);
    expect(queue.add.mock.calls.map((call) => call[2]?.jobId)).toEqual([
      first.id,
      first.id,
    ]);
  });

  it('requeues the existing delivery when the first queue write is lost', async () => {
    const db = createStatefulMockDb(subscription);
    const queue = createMockQueue();
    queue.add
      .mockRejectedValueOnce(new Error('Redis unavailable'))
      .mockResolvedValueOnce({ id: 'job-recovered' });
    const service = new WebhookDeliveryService(
      db as unknown as ConstructorParameters<typeof WebhookDeliveryService>[0],
      undefined,
      queue as unknown as ConstructorParameters<typeof WebhookDeliveryService>[2],
    );
    const logicalEventId = 'bbbbbbbb-0000-4000-a000-000000000002';

    await expect(
      service.enqueue(payload, subscription.id, logicalEventId),
    ).rejects.toThrow('Redis unavailable');
    const [stored] = Array.from(db._deliveries.values());

    const recovered = await service.enqueue(payload, subscription.id, logicalEventId);

    expect(recovered.id).toBe(stored.id);
    expect(db._deliveries.size).toBe(1);
    expect(queue.add.mock.calls.map((call) => call[2]?.jobId)).toEqual([
      stored.id,
      stored.id,
    ]);
  });

  it('updates the row and throws so BullMQ retries on non-2xx response', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    const db = createStatefulMockDb(subscription);
    const queue = createMockQueue();
    const service = new WebhookDeliveryService(db as any, undefined, queue as any);

    const delivery = await service.enqueue(payload, subscription.id);
    await expect(
      service.processDeliveryJob({ deliveryId: delivery.id, propertyId: 'prop-1' }),
    ).rejects.toThrow('scheduled for retry');

    const stored = db._deliveries.get(delivery.id);
    expect(stored.status).toBe('pending');
    expect(stored.attempts).toBe(1);
    expect(stored.lastStatusCode).toBe(500);
    expect(stored.lastError).toBe('HTTP 500');
    expect(stored.nextRetryAt).toBeInstanceOf(Date);
  });

  it('marks failed after max attempts', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    const db = createStatefulMockDb(subscription);
    const queue = createMockQueue();
    const service = new WebhookDeliveryService(db as any, undefined, queue as any);

    const delivery = await service.enqueue(payload, subscription.id);

    for (let i = 0; i < 4; i++) {
      await expect(
        service.processDeliveryJob({ deliveryId: delivery.id, propertyId: 'prop-1' }),
      ).rejects.toThrow('scheduled for retry');
    }
    await service.processDeliveryJob({ deliveryId: delivery.id, propertyId: 'prop-1' });

    const stored = db._deliveries.get(delivery.id);
    expect(stored.status).toBe('failed');
    expect(stored.attempts).toBe(5);
  });

  it('emits webhook.delivery_failed internally on permanent failure', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    const db = createStatefulMockDb({ ...subscription, subscriberName: 'BR Compliance' });
    const queue = createMockQueue();
    const emitter = { emit: vi.fn() };
    const service = new WebhookDeliveryService(db as any, emitter as any, queue as any);

    const delivery = await service.enqueue(payload, subscription.id);

    for (let i = 0; i < 4; i++) {
      await expect(
        service.processDeliveryJob({ deliveryId: delivery.id, propertyId: 'prop-1' }),
      ).rejects.toThrow('scheduled for retry');
    }
    expect(emitter.emit).not.toHaveBeenCalled();

    await service.processDeliveryJob({ deliveryId: delivery.id, propertyId: 'prop-1' });

    expect(emitter.emit).toHaveBeenCalledTimes(1);
    expect(emitter.emit).toHaveBeenCalledWith('webhook.delivery_failed', {
      propertyId: 'prop-1',
      subscriptionId: 'sub-1',
      subscriberName: 'BR Compliance',
      deliveryId: delivery.id,
      eventType: 'reservation.created',
      attempts: 5,
      lastError: 'HTTP 500',
    });
  });

  it('signs "unsigned" when subscription has no secret', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    const sub = { ...subscription, secret: null };
    const db = createStatefulMockDb(sub);
    const queue = createMockQueue();
    const service = new WebhookDeliveryService(db as any, undefined, queue as any);

    const delivery = await service.enqueue(payload, sub.id);
    await service.processDeliveryJob({ deliveryId: delivery.id, propertyId: 'prop-1' });

    const [, init] = fetchMock.mock.calls[0]!;
    expect(init.headers['X-HAIP-Signature']).toBe('unsigned');
  });
});
