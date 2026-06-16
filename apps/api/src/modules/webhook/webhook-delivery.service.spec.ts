import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'crypto';
import { WebhookDeliveryService } from './webhook-delivery.service';

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
  // objects, so we use a simple heuristic: track the last table referenced.
  let currentTable: 'webhook_deliveries' | 'subscriptions' = 'webhook_deliveries';

  const identifyTable = (tbl: any): 'webhook_deliveries' | 'subscriptions' => {
    // @telivityhaip/database exports identifiable symbols on each pgTable. Fall back
    // to a constructor-name check; the test just needs to distinguish.
    const name = tbl?.[Symbol.for('drizzle:Name')] ?? tbl?._?.name ?? '';
    if (String(name).includes('webhook_deliveries')) return 'webhook_deliveries';
    if (String(name).includes('agent_webhook_subscriptions')) return 'subscriptions';
    // Last-resort: alternate between calls based on recent context.
    return currentTable;
  };

  const makeSelectChain = (tableId: 'webhook_deliveries' | 'subscriptions') => ({
    from: vi.fn(() => {
      currentTable = tableId;
      return {
        where: vi.fn(() => {
          // Resolve with all rows for simplicity; callers use .id match.
          if (tableId === 'subscriptions') {
            return Promise.resolve([subscription]);
          }
          // For webhook_deliveries the service expects either a single-row
          // lookup (by id) or a list of pending rows. We return ALL rows; the
          // service filters by id after.
          return Promise.resolve(Array.from(deliveries.values()));
        }),
      };
    }),
  });

  return {
    _deliveries: deliveries,
    select: vi.fn((arg?: any) => {
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
    insert: vi.fn((tbl: any) => ({
      values: vi.fn((vals: any) => ({
        returning: vi.fn(() => {
          const id = `del-${idCounter++}`;
          const row = { id, ...vals };
          deliveries.set(id, row);
          return Promise.resolve([row]);
        }),
      })),
    })),
    update: vi.fn((tbl: any) => ({
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

  beforeEach(() => {
    process.env['NODE_ENV'] = 'test';
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as any;
  });

  afterEach(() => {
    process.env['NODE_ENV'] = originalEnv;
    vi.restoreAllMocks();
  });

  it('enqueues a delivery and POSTs with HMAC signature + event headers', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    const db = createStatefulMockDb(subscription);
    const service = new WebhookDeliveryService(db as any);

    const delivery = await service.enqueue(payload, subscription.id);
    // Await the async attempt fired by enqueue.
    await new Promise((r) => setImmediate(r));

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

  it('schedules a retry on non-2xx response', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    const db = createStatefulMockDb(subscription);
    const service = new WebhookDeliveryService(db as any);

    const delivery = await service.enqueue(payload, subscription.id);
    await new Promise((r) => setImmediate(r));

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
    const service = new WebhookDeliveryService(db as any);

    const delivery = await service.enqueue(payload, subscription.id);
    await new Promise((r) => setImmediate(r));

    // Simulate 4 more retry attempts (total 5 = MAX).
    for (let i = 0; i < 4; i++) {
      await service.attemptDelivery(delivery.id);
    }

    const stored = db._deliveries.get(delivery.id);
    expect(stored.status).toBe('failed');
    expect(stored.attempts).toBe(5);
  });

  it('signs "unsigned" when subscription has no secret', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    const sub = { ...subscription, secret: null };
    const db = createStatefulMockDb(sub);
    const service = new WebhookDeliveryService(db as any);

    await service.enqueue(payload, sub.id);
    await new Promise((r) => setImmediate(r));

    const [, init] = fetchMock.mock.calls[0]!;
    expect(init.headers['X-HAIP-Signature']).toBe('unsigned');
  });
});
