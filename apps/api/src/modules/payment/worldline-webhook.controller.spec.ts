import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { WorldlineWebhookController, signWorldlineBody } from './worldline-webhook.controller';

const SECRET = 'webhook-secret';
const KEY_ID = 'wh-key';

function eventBody(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    apiVersion: 'v1',
    id: 'evt-1',
    type: 'payment.pending_capture',
    merchantId: 'psp-1',
    payment: {
      id: 'pay-wl',
      status: 'PENDING_CAPTURE',
      statusOutput: { statusCode: 5, isAuthorized: true },
      hostedCheckoutSpecificOutput: { hostedCheckoutId: 'hc-1' },
    },
    ...overrides,
  });
}

function request(body: string, signature = signWorldlineBody(body, SECRET)) {
  return {
    body: Buffer.from(body),
    headers: { 'x-gcs-signature': signature, 'x-gcs-keyid': KEY_ID },
  };
}

describe('WorldlineWebhookController', () => {
  function setup(payment: Record<string, unknown> | null = {
    id: 'row-1',
    propertyId: 'prop-1',
    status: 'pending',
    gatewayProvider: 'worldline',
    gatewayTransactionId: 'hc-1',
  }) {
    const returning = vi.fn().mockResolvedValue(payment ? [payment] : []);
    const where = vi.fn().mockReturnValue({ returning, limit: vi.fn().mockResolvedValue(payment ? [payment] : []) });
    const db = {
      select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where }) }),
      transaction: vi.fn(async (fn: (tx: any) => Promise<unknown>) => fn({
        update: () => ({ set: () => ({ where: () => ({ returning: async () => [] }) }) }),
        insert: () => ({ values: async () => undefined }),
        select: () => ({ from: () => ({ where: () => ({ for: async () => [] }) }) }),
      })),
    };
    const credentials = {
      webhookSecretForKeyId: vi.fn(async (keyId: string) => keyId === KEY_ID ? SECRET : null),
      resolveForProperty: vi.fn(async () => ({ merchantId: 'psp-1', apiKeyId: 'k', secretApiKey: 's', environment: 'test' })),
    };
    const webhook = { dispatchPersisted: vi.fn() };
    const controller = new WorldlineWebhookController(db, webhook as any, credentials as any);
    return { controller, db, where };
  }

  it('rejects a bad signature without reading or changing a payment', async () => {
    const { controller, db } = setup();
    const body = eventBody();
    const res = { status: vi.fn().mockReturnThis(), send: vi.fn(), type: vi.fn().mockReturnThis() };
    await controller.handle(request(body, createHmac('sha256', 'wrong').update(body).digest('base64')), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(db.select).not.toHaveBeenCalled();
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('promotes a pending row when a signed pending_capture event is authorized', async () => {
    const { controller, db } = setup();
    const res = { status: vi.fn().mockReturnThis(), send: vi.fn(), type: vi.fn().mockReturnThis() };
    await controller.handle(request(eventBody()), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(db.transaction).toHaveBeenCalledOnce();
  });

  it('echoes the endpoint verification header', async () => {
    const { controller } = setup(null);
    const res = { status: vi.fn().mockReturnThis(), send: vi.fn(), type: vi.fn().mockReturnThis() };
    await controller.verifyEndpoint({ headers: { 'x-gcs-webhooks-endpoint-verification': 'verify-me' } }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith('verify-me');
  });
});
