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
  }, options?: { finalized?: boolean }) {
    const returning = vi.fn().mockResolvedValue(payment ? [payment] : []);
    const where = vi.fn().mockReturnValue({ returning, limit: vi.fn().mockResolvedValue(payment ? [payment] : []) });
    const db = {
      select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where }) }),
      transaction: vi.fn(async (fn: (tx: any) => Promise<unknown>) => fn({
        update: () => ({ set: () => ({ where: () => ({ returning: async () => (options?.finalized && payment ? [payment] : []) }) }) }),
        insert: () => ({ values: async () => undefined }),
        select: () => ({ from: () => ({ where: () => ({ for: async () => [] }) }) }),
      })),
    };
    const credentials = {
      webhookSecretForKeyId: vi.fn(async (keyId: string) => (
        keyId === KEY_ID ? { secret: SECRET, propertyId: 'prop-1', merchantId: 'psp-1' } : null
      )),
      resolveForProperty: vi.fn(async () => ({ merchantId: 'psp-1', apiKeyId: 'k', secretApiKey: 's', environment: 'test' })),
    };
    const webhook = { dispatchPersisted: vi.fn() };
    const folio = { recalculateBalance: vi.fn() };
    const controller = new WorldlineWebhookController(db, webhook as any, credentials as any, folio as any);
    return { controller, db, where, folio };
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
    const { controller, db, where } = setup();
    const res = { status: vi.fn().mockReturnThis(), send: vi.fn(), type: vi.fn().mockReturnThis() };
    await controller.handle(request(eventBody()), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(db.transaction).toHaveBeenCalledOnce();
    const { PgDialect } = await import('drizzle-orm/pg-core');
    const query = new PgDialect().sqlToQuery(where.mock.calls[0][0]);
    expect(query.params).toEqual(expect.arrayContaining(['worldline', 'prop-1']));
  });

  it('rejects a signed event that omits the merchant or names a different one', async () => {
    const { controller, db } = setup();
    const res = { status: vi.fn().mockReturnThis(), send: vi.fn(), type: vi.fn().mockReturnThis() };
    await controller.handle(request(eventBody({ merchantId: '' })), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(db.select).not.toHaveBeenCalled();

    const mismatch = { status: vi.fn().mockReturnThis(), send: vi.fn(), type: vi.fn().mockReturnThis() };
    await controller.handle(request(eventBody({ merchantId: 'other-merchant' })), mismatch);
    expect(mismatch.status).toHaveBeenCalledWith(400);
    expect(db.select).not.toHaveBeenCalled();
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('completes a captured payment when a signed capture has status code 9', async () => {
    const { controller, db } = setup();
    const body = eventBody({
      type: 'payment.captured',
      payment: {
        id: 'pay-wl',
        status: 'CAPTURED',
        statusOutput: { statusCode: 9 },
        hostedCheckoutSpecificOutput: { hostedCheckoutId: 'hc-1' },
      },
    });
    const res = { status: vi.fn().mockReturnThis(), send: vi.fn(), type: vi.fn().mockReturnThis() };
    await controller.handle(request(body), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(db.transaction).toHaveBeenCalledOnce();
  });

  it('recalculates the folio when a capture is stored', async () => {
    const { controller, folio } = setup({
      id: 'row-1',
      propertyId: 'prop-1',
      folioId: 'folio-1',
      amount: '40.00',
      status: 'pending',
      gatewayProvider: 'worldline',
      gatewayTransactionId: 'hc-1',
      authorizationFinalization: null,
    }, { finalized: true });
    const body = eventBody({
      type: 'payment.captured',
      payment: {
        id: 'pay-wl',
        status: 'CAPTURED',
        statusOutput: { statusCode: 9 },
        hostedCheckoutSpecificOutput: { hostedCheckoutId: 'hc-1' },
      },
    });
    const res = { status: vi.fn().mockReturnThis(), send: vi.fn(), type: vi.fn().mockReturnThis() };
    await controller.handle(request(body), res);
    expect(folio.recalculateBalance).toHaveBeenCalledWith('folio-1', 'prop-1');
  });

  it('declines a cancelled payment when status code 2 has no status text', async () => {
    const { controller, db } = setup();
    const body = eventBody({
      type: 'payment.cancelled',
      payment: {
        id: 'pay-wl',
        statusOutput: { statusCode: 2 },
        hostedCheckoutSpecificOutput: { hostedCheckoutId: 'hc-1' },
      },
    });
    const res = { status: vi.fn().mockReturnThis(), send: vi.fn(), type: vi.fn().mockReturnThis() };
    await controller.handle(request(body), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(db.transaction).toHaveBeenCalledOnce();
  });

  it('does not promote a pending_capture event that has no payment id', async () => {
    const { controller, db } = setup();
    const body = eventBody({
      payment: {
        status: 'PENDING_CAPTURE',
        statusOutput: { statusCode: 5, isAuthorized: true },
        hostedCheckoutSpecificOutput: { hostedCheckoutId: 'hc-1' },
      },
    });
    const res = { status: vi.fn().mockReturnThis(), send: vi.fn(), type: vi.fn().mockReturnThis() };
    await controller.handle(request(body), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('echoes the endpoint verification header', async () => {
    const { controller } = setup(null);
    const res = { status: vi.fn().mockReturnThis(), send: vi.fn(), type: vi.fn().mockReturnThis() };
    await controller.verifyEndpoint({ headers: { 'x-gcs-webhooks-endpoint-verification': 'verify-me' } }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith('verify-me');
  });
});
