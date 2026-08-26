import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import {
  auditLogs,
  bookingRequestConsequences,
  bookingRequestEmailDeliveries,
  bookingRequestPaymentResolutions,
  bookingRequests,
  payments,
} from '@telivityhaip/database';
import { DRIZZLE } from '../../database/database.module';
import { FolioService } from '../folio/folio.service';
import { WebhookService } from '../webhook/webhook.service';
import { reconcileBookingRequestPaymentAllocations } from '../booking-request/booking-request-allocation-reconciler';
import { BookingRequestPaymentService } from '../booking-request/booking-request-payment.service';
import { StripeWebhookController } from './stripe-webhook.controller';

vi.mock('../booking-request/booking-request-allocation-reconciler', () => ({
  reconcileBookingRequestPaymentAllocations: vi.fn().mockResolvedValue(undefined),
}));

const PROPERTY_ID = 'aaaaaaaa-0000-4000-a000-000000000001';
const REQUEST_ID = 'bbbbbbbb-0000-4000-a000-000000000001';
const PAYMENT_ID = 'cccccccc-0000-4000-a000-000000000001';
const FOLIO_ID = 'dddddddd-0000-4000-a000-000000000001';

type State = {
  requests: any[];
  payments: any[];
  resolutions: any[];
  consequences: any[];
  audits: any[];
  emails: any[];
};

function request(overrides: Record<string, unknown> = {}) {
  return {
    id: REQUEST_ID,
    propertyId: PROPERTY_ID,
    status: 'pending',
    acceptedFolioId: null,
    currencyCode: 'USD',
    stripeCustomerId: 'cus_saved',
    stripePaymentMethodId: 'pm_saved',
    guestFirstName: 'Ada',
    guestEmail: 'ada@example.com',
    ...overrides,
  };
}

function payment(overrides: Record<string, unknown> = {}) {
  return {
    id: PAYMENT_ID,
    propertyId: PROPERTY_ID,
    bookingRequestId: REQUEST_ID,
    folioId: null,
    method: 'credit_card',
    status: 'pending',
    amount: '100.00',
    currencyCode: 'USD',
    gatewayProvider: 'stripe',
    gatewayTransactionId: 'pi_request_1',
    gatewayPaymentToken: 'pm_saved',
    originalPaymentId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function unknownPaymentIntent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pi_recovered_from_metadata',
    amount: 2500,
    amount_received: 2500,
    currency: 'usd',
    customer: 'cus_saved',
    payment_method: 'pm_saved',
    metadata: {
      haip_payment_id: PAYMENT_ID,
      haip_property_id: PROPERTY_ID,
      haip_booking_request_id: REQUEST_ID,
    },
    ...overrides,
  };
}

function knownPaymentIntent(overrides: Record<string, unknown> = {}) {
  return unknownPaymentIntent({
    id: 'pi_request_1',
    amount: 10000,
    amount_received: 10000,
    metadata: {},
    ...overrides,
  });
}

function resolution(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    propertyId: PROPERTY_ID,
    bookingRequestId: REQUEST_ID,
    paymentId: PAYMENT_ID,
    type: 'refund',
    status: 'pending',
    amount: '25.00',
    idempotencyKey: `booking-request-refund:${id}`,
    operationFingerprint: `fingerprint-${id}`,
    providerTransactionId: null,
    providerStatus: null,
    movementId: null,
    attempts: 0,
    lastError: null,
    resolvedAt: null,
    ...overrides,
  };
}

function rowsFor(state: State, table: unknown): any[] {
  if (table === bookingRequests) return state.requests;
  if (table === payments) return state.payments;
  if (table === bookingRequestPaymentResolutions) return state.resolutions;
  if (table === bookingRequestConsequences) return state.consequences;
  if (table === auditLogs) return state.audits;
  if (table === bookingRequestEmailDeliveries) return state.emails;
  throw new Error('Unexpected table in Stripe webhook test');
}

function conditionValues(condition: unknown): Array<{ column: string; value: unknown }> {
  const found: Array<{ column: string; value: unknown }> = [];
  const seen = new WeakSet<object>();
  const visit = (value: unknown) => {
    if (typeof value !== 'object' || value === null || seen.has(value)) return;
    seen.add(value);
    const item = value as any;
    if (item.constructor?.name === 'Param' && item.encoder?.name) {
      found.push({ column: item.encoder.name, value: item.value });
      return;
    }
    if (Array.isArray(item)) {
      for (const nested of item) visit(nested);
      return;
    }
    if (Array.isArray(item.queryChunks)) {
      for (const nested of item.queryChunks) visit(nested);
    }
  };
  visit(condition);
  return found;
}

function camel(column: string): string {
  return column.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

function matches(row: any, condition: unknown): boolean {
  return conditionValues(condition).every(({ column, value }) => row[camel(column)] === value);
}

function makeDb(state: State) {
  let sequence = 0;
  const select = vi.fn(() => {
    let table: unknown;
    let condition: unknown;
    let limit: number | undefined;
    const result = () => {
      const selected = rowsFor(state, table).filter((row) => !condition || matches(row, condition));
      return structuredClone(limit == null ? selected : selected.slice(0, limit));
    };
    const chain: any = {
      from: vi.fn((value: unknown) => { table = value; return chain; }),
      where: vi.fn((value: unknown) => { condition = value; return chain; }),
      for: vi.fn(async () => result()),
      limit: vi.fn((value: number) => { limit = value; return chain; }),
      then: (resolve: any, reject: any) => Promise.resolve(result()).then(resolve, reject),
    };
    return chain;
  });
  const insert = vi.fn((table: unknown) => ({
    values: vi.fn((input: Record<string, unknown>) => {
      let inserted: any;
      let attempted = false;
      const perform = (ignoreConflict = false) => {
        if (attempted) return inserted ? [structuredClone(inserted)] : [];
        attempted = true;
        const rows = rowsFor(state, table);
        if (table === bookingRequestConsequences && rows.some((row) =>
          row.propertyId === input['propertyId']
          && row.bookingRequestId === input['bookingRequestId']
          && row.kind === input['kind'])) {
          return [];
        }
        if (table === bookingRequestEmailDeliveries && rows.some((row) =>
          row.propertyId === input['propertyId']
          && row.bookingRequestId === input['bookingRequestId']
          && row.logicalKey === input['logicalKey'])) {
          return [];
        }
        if (table === payments && input['idempotencyKey'] && rows.some((row) =>
          row.propertyId === input['propertyId'] && row.idempotencyKey === input['idempotencyKey'])) {
          if (!ignoreConflict) throw new Error('duplicate payment idempotency');
          return [];
        }
        sequence += 1;
        inserted = {
          id: input['id'] ?? `eeeeeeee-0000-4000-a000-${String(sequence).padStart(12, '0')}`,
          ...structuredClone(input),
          createdAt: input['createdAt'] ?? new Date(),
          updatedAt: input['updatedAt'] ?? new Date(),
        };
        rows.push(inserted);
        return [structuredClone(inserted)];
      };
      const thenable = (ignoreConflict = false) => ({
        returning: vi.fn(async () => perform(ignoreConflict)),
        then: (resolve: any, reject: any) => Promise.resolve(perform(ignoreConflict)).then(resolve, reject),
      });
      return {
        ...thenable(),
        onConflictDoNothing: vi.fn(() => thenable(true)),
      };
    }),
  }));
  const update = vi.fn((table: unknown) => ({
    set: vi.fn((values: Record<string, unknown>) => ({
      where: vi.fn((condition: unknown) => {
        const apply = () => {
          const changed = rowsFor(state, table).filter((row) => matches(row, condition));
          for (const row of changed) Object.assign(row, structuredClone(values));
          return structuredClone(changed);
        };
        return {
          returning: vi.fn(async () => apply()),
          then: (resolve: any, reject: any) => Promise.resolve(apply()).then(resolve, reject),
        };
      }),
    })),
  }));
  const db: any = { select, insert, update };
  db.transaction = vi.fn(async (callback: (tx: any) => Promise<unknown>) => {
    const snapshot = structuredClone(state);
    try {
      return await callback(db);
    } catch (error) {
      for (const key of Object.keys(state) as Array<keyof State>) {
        state[key].splice(0, state[key].length, ...snapshot[key]);
      }
      throw error;
    }
  });
  return db;
}

const config = {
  get: vi.fn((key: string, fallback?: string) => key === 'STRIPE_MODE' ? 'mock' : fallback),
};

async function harness(overrides: Partial<State> = {}) {
  const state: State = {
    requests: [request()],
    payments: [payment()],
    resolutions: [],
    consequences: [],
    audits: [],
    emails: [],
    ...structuredClone(overrides),
  };
  const db = makeDb(state);
  const webhookService = { emit: vi.fn() };
  const folioService = { recalculateBalance: vi.fn().mockResolvedValue(undefined) };
  const module = await Test.createTestingModule({
    controllers: [StripeWebhookController],
    providers: [
      { provide: DRIZZLE, useValue: db },
      { provide: WebhookService, useValue: webhookService },
      { provide: FolioService, useValue: folioService },
      { provide: ConfigService, useValue: config },
    ],
  }).compile();
  return {
    controller: module.get(StripeWebhookController) as any,
    state,
    db,
    webhookService,
    folioService,
  };
}

function refundEvent(claimId: string, id: string, status = 'succeeded', amount = 2500) {
  return {
    id,
    status,
    amount,
    currency: 'usd',
    payment_intent: 'pi_request_1',
    failure_reason: status === 'failed' ? 'declined' : null,
    metadata: {
      haip_claim_id: claimId,
      haip_property_id: PROPERTY_ID,
      haip_booking_request_id: REQUEST_ID,
      haip_payment_id: PAYMENT_ID,
    },
  };
}

async function deliverStripeWebhook(controller: any, event: Record<string, unknown>) {
  controller.stripe = {
    webhooks: {
      constructEvent: vi.fn(() => event),
    },
  };
  controller.webhookSecret = 'whsec_test';
  config.get.mockImplementation((key: string, fallback?: string) =>
    key === 'STRIPE_MODE' ? 'live' : fallback);
  const response = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };

  await controller.handleWebhook({
    headers: { 'stripe-signature': 'test-signature' },
    body: Buffer.from('{}'),
  }, response);

  return response;
}

describe('StripeWebhookController financial finalization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    config.get.mockImplementation((key: string, fallback?: string) =>
      key === 'STRIPE_MODE' ? 'mock' : fallback);
  });

  it('keeps mock-mode HTTP behavior inert', async () => {
    const h = await harness();
    const response = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
    await h.controller.handleWebhook({}, response);
    expect(response.status).toHaveBeenCalledWith(200);
  });

  it.each([
    ['payment_intent.succeeded', unknownPaymentIntent({ id: 'pi_external_success', metadata: {} })],
    ['payment_intent.payment_failed', unknownPaymentIntent({ id: 'pi_external_failure', metadata: {} })],
    ['refund.updated', {
      id: 're_external', status: 'succeeded', amount: 2500, currency: 'usd', metadata: {},
    }],
  ])('acknowledges unrelated %s without financial side effects', async (type, object) => {
    const h = await harness({ requests: [], payments: [] });

    const response = await deliverStripeWebhook(h.controller, {
      id: `evt_${type}`,
      type,
      data: { object },
    });

    expect(response.status).toHaveBeenCalledWith(200);
    expect(h.state).toEqual({
      requests: [], payments: [], resolutions: [], consequences: [], audits: [], emails: [],
    });
    expect(h.webhookService.emit).not.toHaveBeenCalled();
    expect(h.folioService.recalculateBalance).not.toHaveBeenCalled();
    expect(h.db.transaction).not.toHaveBeenCalled();
  });

  it('rejects incomplete HAIP metadata on an otherwise uncorrelated PaymentIntent', async () => {
    const h = await harness({ requests: [], payments: [] });

    await expect(h.controller.handlePaymentIntentSucceeded(unknownPaymentIntent({
      id: 'pi_malformed_owned',
      metadata: { haip_payment_id: PAYMENT_ID },
    }))).rejects.toThrow(/correlation metadata/i);

    expect(h.state).toEqual({
      requests: [], payments: [], resolutions: [], consequences: [], audits: [], emails: [],
    });
    expect(h.db.transaction).not.toHaveBeenCalled();
  });

  it('finalizes a pending request PaymentIntent under request→payment locks with fresh folio', async () => {
    const h = await harness({ requests: [request({ status: 'accepted', acceptedFolioId: FOLIO_ID })] });
    await h.controller.handlePaymentIntentSucceeded(knownPaymentIntent());
    expect(h.state.payments[0]).toMatchObject({ status: 'captured', folioId: FOLIO_ID });
    expect(h.state.consequences).toEqual([
      expect.objectContaining({ kind: expect.stringMatching(/^payment_received:/), status: 'pending' }),
    ]);
    expect(h.state.emails).toEqual([
      expect.objectContaining({ kind: 'payment', logicalKey: expect.stringMatching(/^payment:/) }),
    ]);
    expect(JSON.stringify(h.state.emails)).not.toMatch(/pi_request|pm_saved|cus_saved|https?:\/\//i);
    expect(h.folioService.recalculateBalance).toHaveBeenCalledWith(FOLIO_ID, PROPERTY_ID, h.db);
    expect(h.webhookService.emit).not.toHaveBeenCalled();
  });

  it('binds and finalizes an unknown PaymentIntent from exact signed metadata', async () => {
    const clientKey = 'api-crashed-before-provider-id-commit';
    const idempotencyKey = `booking-request-charge:${createHash('sha256')
      .update(`${PROPERTY_ID}:${clientKey}`)
      .digest('hex')}`;
    const h = await harness({
      requests: [request({
        currencyCode: 'USD',
        submittedQuoteSnapshot: { grandTotal: '100.00' },
        stripeCustomerId: 'cus_saved',
        stripePaymentMethodId: 'pm_saved',
      })],
      payments: [payment({
        gatewayTransactionId: null,
        idempotencyKey,
        amount: '25.00',
      })],
    });
    const pi = unknownPaymentIntent();

    await h.controller.handlePaymentIntentSucceeded(pi);
    await h.controller.handlePaymentIntentSucceeded(pi);

    expect(h.state.payments[0]).toMatchObject({
      status: 'captured',
      gatewayTransactionId: 'pi_recovered_from_metadata',
    });
    expect(h.state.consequences).toHaveLength(1);
    expect(h.state.emails).toHaveLength(1);

    const gateway = { charge: vi.fn() };
    const service = new (BookingRequestPaymentService as any)(
      h.db,
      gateway,
      h.folioService,
      { refund: vi.fn() },
      { deliverForRequestBestEffort: vi.fn() },
    ) as BookingRequestPaymentService;
    const replay = await service.chargeSavedCard(
      REQUEST_ID,
      PROPERTY_ID,
      { amount: '25.00', idempotencyKey: clientKey },
    );
    expect(replay).toMatchObject({
      id: PAYMENT_ID,
      status: 'captured',
    });
    expect(replay).not.toHaveProperty('gatewayTransactionId');
    expect(gateway.charge).not.toHaveBeenCalled();
  });

  it.each([
    ['configured amount', { amount: 2600 }],
    ['received amount', { amount_received: 2400 }],
    ['currency', { currency: 'eur' }],
    ['customer', { customer: 'cus_copied_metadata' }],
    ['payment method', { payment_method: 'pm_copied_metadata' }],
  ])('rejects copied metadata with the wrong %s before binding', async (_label, overrides) => {
    const h = await harness({
      requests: [request({
        currencyCode: 'USD',
        stripeCustomerId: 'cus_saved',
        stripePaymentMethodId: 'pm_saved',
      })],
      payments: [payment({ gatewayTransactionId: null, amount: '25.00' })],
    });

    await expect(h.controller.handlePaymentIntentSucceeded(
      unknownPaymentIntent(overrides),
    )).rejects.toThrow(/amount|currency|customer|payment method|identity/i);
    expect(h.state.payments[0]).toMatchObject({
      status: 'pending',
      gatewayTransactionId: null,
    });
    expect(h.state.consequences).toHaveLength(0);
  });

  it('binds a processing PaymentIntent using configured amount while received amount is zero', async () => {
    const h = await harness({
      requests: [request({
        currencyCode: 'USD',
        stripeCustomerId: 'cus_saved',
        stripePaymentMethodId: 'pm_saved',
      })],
      payments: [payment({ gatewayTransactionId: null, amount: '25.00' })],
    });

    await h.controller.handlePaymentIntentProcessing(unknownPaymentIntent({
      id: 'pi_processing_from_metadata',
      amount_received: 0,
    }));

    expect(h.state.payments[0]).toMatchObject({
      status: 'pending',
      gatewayTransactionId: 'pi_processing_from_metadata',
    });
    expect(h.state.consequences).toHaveLength(0);
  });

  it.each([
    ['handlePaymentIntentProcessing', { amount: 2600 }],
    ['handlePaymentIntentProcessing', { currency: 'eur' }],
    ['handlePaymentIntentProcessing', { customer: 'cus_wrong' }],
    ['handlePaymentIntentProcessing', { payment_method: 'pm_wrong' }],
    ['handlePaymentIntentSucceeded', { amount: 2600 }],
    ['handlePaymentIntentSucceeded', { currency: 'eur' }],
    ['handlePaymentIntentSucceeded', { customer: 'cus_wrong' }],
    ['handlePaymentIntentSucceeded', { payment_method: 'pm_wrong' }],
    ['handlePaymentIntentFailed', { amount: 2600 }],
    ['handlePaymentIntentFailed', { currency: 'eur' }],
    ['handlePaymentIntentFailed', { customer: 'cus_wrong' }],
    ['handlePaymentIntentFailed', { payment_method: 'pm_wrong' }],
    ['handlePaymentIntentCanceled', { amount: 2600 }],
    ['handlePaymentIntentCanceled', { currency: 'eur' }],
    ['handlePaymentIntentCanceled', { customer: 'cus_wrong' }],
    ['handlePaymentIntentCanceled', { payment_method: 'pm_wrong' }],
    ['handlePaymentIntentRequiresAction', { amount: 2600 }],
    ['handlePaymentIntentRequiresAction', { currency: 'eur' }],
    ['handlePaymentIntentRequiresAction', { customer: 'cus_wrong' }],
    ['handlePaymentIntentRequiresAction', { payment_method: 'pm_wrong' }],
  ] as const)('%s rejects copied metadata identity before binding', async (method, overrides) => {
    const h = await harness({
      payments: [payment({ gatewayTransactionId: null, amount: '25.00' })],
    });

    await expect(h.controller[method](unknownPaymentIntent(overrides)))
      .rejects.toThrow(/amount|currency|customer|payment method|identity/i);

    expect(h.state.payments[0]).toMatchObject({
      status: 'pending',
      gatewayTransactionId: null,
    });
    expect(h.state.consequences).toHaveLength(0);
    expect(h.state.audits).toEqual([
      expect.objectContaining({
        propertyId: PROPERTY_ID,
        entityId: PAYMENT_ID,
        description: expect.stringMatching(/identity mismatch/i),
      }),
    ]);
  });

  it('audits provider binding once and audits a later folio relink only when it changes', async () => {
    const h = await harness({
      requests: [request({ status: 'accepted', acceptedFolioId: FOLIO_ID })],
      payments: [payment({ gatewayTransactionId: null, amount: '25.00' })],
    });
    const pi = unknownPaymentIntent({ amount_received: 0 });

    await h.controller.handlePaymentIntentProcessing(pi);
    await h.controller.handlePaymentIntentProcessing(pi);
    expect(h.state.audits).toEqual([
      expect.objectContaining({
        propertyId: PROPERTY_ID,
        previousValue: expect.objectContaining({
          bookingRequestId: REQUEST_ID,
          gatewayTransactionId: null,
        }),
        newValue: expect.objectContaining({
          bookingRequestId: REQUEST_ID,
          gatewayTransactionId: pi.id,
        }),
      }),
      expect.objectContaining({
        propertyId: PROPERTY_ID,
        previousValue: expect.objectContaining({ bookingRequestId: REQUEST_ID, folioId: null }),
        newValue: expect.objectContaining({ bookingRequestId: REQUEST_ID, folioId: FOLIO_ID }),
      }),
    ]);

    await h.controller.handlePaymentIntentProcessing(pi);
    expect(h.state.audits).toHaveLength(2);
  });

  it.each([
    ['received amount', { amount_received: 9900 }],
    ['currency', { currency: 'eur' }],
    ['customer', { customer: 'cus_wrong' }],
    ['payment method', { payment_method: 'pm_wrong' }],
  ])('rejects an existing-id succeeded event with wrong %s and audits without mutation', async (
    _label,
    succeededOverrides,
  ) => {
    const h = await harness();
    await h.controller.handlePaymentIntentProcessing(knownPaymentIntent({ amount_received: 0 }));
    const before = structuredClone(h.state.payments[0]);

    await expect(h.controller.handlePaymentIntentSucceeded(
      knownPaymentIntent(succeededOverrides),
    )).rejects.toThrow(/amount|currency|customer|payment method|identity/i);

    expect(h.state.payments[0]).toEqual(before);
    expect(h.state.consequences).toHaveLength(0);
    expect(h.state.audits).toEqual([
      expect.objectContaining({
        propertyId: PROPERTY_ID,
        entityId: PAYMENT_ID,
        previousValue: expect.objectContaining({
          bookingRequestId: REQUEST_ID,
          status: 'pending',
        }),
        newValue: expect.objectContaining({
          bookingRequestId: REQUEST_ID,
          providerEvent: 'succeeded',
          reason: expect.stringMatching(/identity/i),
        }),
      }),
    ]);
  });

  it.each([
    ['incomplete', { haip_payment_id: PAYMENT_ID }],
    ['cross-property', {
      haip_payment_id: PAYMENT_ID,
      haip_property_id: 'aaaaaaaa-0000-4000-a000-000000000099',
      haip_booking_request_id: REQUEST_ID,
    }],
    ['cross-request', {
      haip_payment_id: PAYMENT_ID,
      haip_property_id: PROPERTY_ID,
      haip_booking_request_id: 'bbbbbbbb-0000-4000-a000-000000000099',
    }],
    ['spoofed-payment', {
      haip_payment_id: 'cccccccc-0000-4000-a000-000000000099',
      haip_property_id: PROPERTY_ID,
      haip_booking_request_id: REQUEST_ID,
    }],
  ] as const)('rejects %s metadata for an unknown PaymentIntent', async (_label, metadata) => {
    const h = await harness({ payments: [payment({ gatewayTransactionId: null })] });

    await expect(h.controller.handlePaymentIntentSucceeded({
      id: 'pi_unknown_spoofed', metadata,
    })).rejects.toThrow(/metadata|identify|correlation/i);
    expect(h.state.payments[0]).toMatchObject({
      status: 'pending',
      gatewayTransactionId: null,
    });
  });

  it.each([
    ['terminal state', { status: 'failed', gatewayTransactionId: null }],
    ['different provider identity', { status: 'pending', gatewayTransactionId: 'pi_other' }],
  ])('rejects metadata binding against a %s', async (_label, overrides) => {
    const h = await harness({ payments: [payment(overrides)] });

    await expect(h.controller.handlePaymentIntentSucceeded({
      id: 'pi_unknown_conflict',
      metadata: {
        haip_payment_id: PAYMENT_ID,
        haip_property_id: PROPERTY_ID,
        haip_booking_request_id: REQUEST_ID,
      },
    })).rejects.toThrow(/pending payment|already bound|provider identity/i);
    expect(h.state.payments[0]!.status).toBe(overrides.status);
  });

  it('repairs a captured replay without duplicating its durable consequence', async () => {
    const h = await harness({
      requests: [request({ status: 'accepted', acceptedFolioId: FOLIO_ID })],
      payments: [payment({ status: 'captured', folioId: null })],
    });
    await h.controller.handlePaymentIntentSucceeded(knownPaymentIntent());
    await h.controller.handlePaymentIntentSucceeded(knownPaymentIntent());
    expect(h.state.payments[0]!.folioId).toBe(FOLIO_ID);
    expect(h.state.consequences).toHaveLength(1);
    expect(h.state.emails).toHaveLength(1);
    expect(h.folioService.recalculateBalance).toHaveBeenCalledTimes(2);
  });

  it.each(['failed', 'voided'] as const)('does not regress terminal %s to captured', async (status) => {
    const h = await harness({ payments: [payment({ status })] });
    await h.controller.handlePaymentIntentSucceeded(knownPaymentIntent());
    expect(h.state.payments[0]!.status).toBe(status);
    expect(h.state.consequences).toHaveLength(0);
    expect(h.state.audits).toEqual(expect.arrayContaining([
      expect.objectContaining({ description: expect.stringMatching(/unexpected/i) }),
    ]));
  });

  it('durably audits and rejects a capture reported after denial', async () => {
    const h = await harness({ requests: [request({ status: 'denied' })] });
    await expect(h.controller.handlePaymentIntentSucceeded(knownPaymentIntent()))
      .rejects.toThrow(/denial|denied/i);
    expect(h.state.payments[0]!.status).toBe('pending');
    expect(h.state.audits).toHaveLength(1);
  });

  it('makes provider failure/requires-action terminal and emits a durable failed consequence', async () => {
    for (const method of ['handlePaymentIntentFailed', 'handlePaymentIntentRequiresAction']) {
      const h = await harness();
      await h.controller[method](knownPaymentIntent({
        last_payment_error: { message: 'Declined' },
      }));
      expect(h.state.payments[0]!.status).toBe('failed');
      expect(h.state.consequences[0]!.kind).toMatch(/^payment_failed:/);
      expect(h.state.emails).toEqual([
        expect.objectContaining({ kind: 'failure', logicalKey: expect.stringMatching(/^failure:/) }),
      ]);
      await h.controller.handlePaymentIntentSucceeded(knownPaymentIntent());
      expect(h.state.payments[0]!.status).toBe('failed');
    }
  });

  it('correlates one of two equal refund claims by UUID and provider refund ID', async () => {
    const first = resolution('11111111-0000-4000-a000-000000000001');
    const second = resolution('22222222-0000-4000-a000-000000000002');
    const h = await harness({ resolutions: [first, second] });
    await h.controller.handleRefundUpdated(refundEvent(second.id, 're_second'));
    expect(h.state.resolutions.find((row) => row.id === first.id)!.status).toBe('pending');
    expect(h.state.resolutions.find((row) => row.id === second.id)).toMatchObject({
      status: 'completed',
      providerTransactionId: 're_second',
      providerStatus: 'succeeded',
      movementId: expect.any(String),
    });
    expect(h.state.payments.filter((row) => row.originalPaymentId === PAYMENT_ID)).toEqual([
      expect.objectContaining({ amount: '-25.00', gatewayTransactionId: 're_second' }),
    ]);
    expect(h.state.emails).toEqual([
      expect.objectContaining({ kind: 'refund', logicalKey: expect.stringMatching(/^refund:/) }),
    ]);
    expect(JSON.stringify(h.state.emails)).not.toContain('re_second');
  });

  it('handles two 25 refunds out of order and replays without double ledger rows', async () => {
    const first = resolution('11111111-0000-4000-a000-000000000001');
    const second = resolution('22222222-0000-4000-a000-000000000002');
    const h = await harness({ resolutions: [first, second] });
    await h.controller.handleRefundUpdated(refundEvent(second.id, 're_second'));
    await h.controller.handleRefundUpdated(refundEvent(first.id, 're_first'));
    await h.controller.handleRefundUpdated(refundEvent(second.id, 're_second'));
    expect(h.state.payments.filter((row) => row.originalPaymentId === PAYMENT_ID))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ gatewayTransactionId: 're_first', amount: '-25.00' }),
        expect.objectContaining({ gatewayTransactionId: 're_second', amount: '-25.00' }),
      ]));
    expect(h.state.payments.filter((row) => row.originalPaymentId === PAYMENT_ID)).toHaveLength(2);
    expect(h.state.consequences.filter((row) => row.kind.startsWith('payment_refunded:'))).toHaveLength(2);
  });

  it('records pending refund identity, then completes the same claim/provider refund', async () => {
    const claim = resolution('11111111-0000-4000-a000-000000000001');
    const h = await harness({ resolutions: [claim] });
    await h.controller.handleRefundUpdated(refundEvent(claim.id, 're_pending', 'pending'));
    expect(h.state.resolutions[0]).toMatchObject({
      status: 'pending', providerTransactionId: 're_pending', providerStatus: 'pending',
    });
    await h.controller.handleRefundUpdated(refundEvent(claim.id, 're_pending', 'succeeded'));
    expect(h.state.resolutions[0]!.status).toBe('completed');
    expect(h.state.payments.filter((row) => row.originalPaymentId === PAYMENT_ID)).toHaveLength(1);
  });

  it.each(['failed', 'canceled'] as const)('makes refund %s terminal and ignores late success', async (status) => {
    const claim = resolution('11111111-0000-4000-a000-000000000001');
    const h = await harness({ resolutions: [claim] });
    await h.controller.handleRefundUpdated(refundEvent(claim.id, `re_${status}`, status));
    expect(h.state.resolutions[0]!.status).toBe('failed');
    await h.controller.handleRefundUpdated(refundEvent(claim.id, `re_${status}`, 'succeeded'));
    expect(h.state.resolutions[0]!.status).toBe('failed');
    expect(h.state.payments.filter((row) => row.originalPaymentId === PAYMENT_ID)).toHaveLength(0);
  });

  it('treats cumulative charge.refunded as a reconciliation signal, never a claim match', async () => {
    const first = resolution('11111111-0000-4000-a000-000000000001');
    const second = resolution('22222222-0000-4000-a000-000000000002');
    const h = await harness({ resolutions: [first, second] });
    await h.controller.handleChargeRefunded({
      id: 'ch_cumulative', payment_intent: 'pi_request_1', amount_refunded: 5000,
      currency: 'usd', refunds: { data: [] },
    });
    expect(h.state.resolutions.every((row) => row.status === 'pending')).toBe(true);
    expect(h.state.payments).toHaveLength(1);
    expect(h.state.audits[0]!.description).toMatch(/reconciliation signal/i);
  });

  it('does not complete an exact claim from embedded charge.refunded objects', async () => {
    const claim = resolution('11111111-0000-4000-a000-000000000001');
    const h = await harness({ resolutions: [claim] });
    await h.controller.handleChargeRefunded({
      id: 'ch_embedded',
      payment_intent: 'pi_request_1',
      amount_refunded: 2500,
      currency: 'usd',
      refunds: { data: [refundEvent(claim.id, 're_embedded')] },
    });
    expect(h.state.resolutions[0]).toMatchObject({
      status: 'pending',
      providerTransactionId: null,
      movementId: null,
    });
    expect(h.state.payments).toHaveLength(1);
    expect(h.state.audits[0]!.description).toMatch(/reconciliation signal/i);
  });

  it('acknowledges a charge refund when its locked parent disappears after lookup', async () => {
    const legacy = payment({
      bookingRequestId: null, folioId: FOLIO_ID, amount: '100.00', status: 'captured',
    });
    const h = await harness({ requests: [], payments: [legacy] });
    const transaction = h.db.transaction.getMockImplementation();
    h.db.transaction.mockImplementation(async (callback: (tx: any) => Promise<unknown>) => {
      h.state.payments.splice(0, h.state.payments.length);
      return transaction(callback);
    });

    await expect(h.controller.handleChargeRefunded({
      id: 'ch_deleted_parent', payment_intent: 'pi_request_1', amount_refunded: 2500,
      currency: 'usd', refunds: { data: [] },
    })).resolves.toBeUndefined();

    expect(h.webhookService.emit).not.toHaveBeenCalled();
    expect(h.folioService.recalculateBalance).not.toHaveBeenCalled();
  });

  it('posts the missing negative movement for a partial instant-booking refund', async () => {
    const legacy = payment({
      bookingRequestId: null, folioId: FOLIO_ID, amount: '100.00', status: 'captured',
    });
    const h = await harness({ requests: [], payments: [legacy] });

    await h.controller.handleChargeRefunded({
      id: 'ch_legacy', payment_intent: 'pi_request_1', amount_refunded: 2500,
      currency: 'usd', refunds: { data: [] },
    });

    expect(h.state.payments).toContainEqual(expect.objectContaining({
      propertyId: PROPERTY_ID,
      folioId: FOLIO_ID,
      originalPaymentId: PAYMENT_ID,
      amount: '-25.00',
      status: 'captured',
      gatewayProvider: 'stripe',
      idempotencyKey: 'stripe-charge-refund:ch_legacy:2500',
    }));
    expect(h.folioService.recalculateBalance)
      .toHaveBeenCalledWith(FOLIO_ID, PROPERTY_ID, h.db);
    expect(h.webhookService.emit).toHaveBeenCalledWith(
      'payment.refunded',
      'payment',
      expect.any(String),
      expect.objectContaining({ folioId: FOLIO_ID, originalPaymentId: PAYMENT_ID, refundAmount: '25.00' }),
      PROPERTY_ID,
    );
  });

  it('posts the complete captured amount for a full instant-booking refund', async () => {
    const legacy = payment({
      bookingRequestId: null, folioId: FOLIO_ID, amount: '100.00', status: 'captured',
    });
    const h = await harness({ requests: [], payments: [legacy] });

    await h.controller.handleChargeRefunded({
      id: 'ch_legacy_full', payment_intent: 'pi_request_1', amount_refunded: 10000,
      currency: 'usd', refunds: { data: [] },
    });

    expect(h.state.payments.filter((row) => row.originalPaymentId === PAYMENT_ID)).toEqual([
      expect.objectContaining({ amount: '-100.00', status: 'captured' }),
    ]);
  });

  it('rejects an instant-booking refund whose currency differs from the captured payment', async () => {
    const legacy = payment({
      bookingRequestId: null, folioId: FOLIO_ID, amount: '100.00', status: 'captured',
    });
    const h = await harness({ requests: [], payments: [legacy] });

    await expect(h.controller.handleChargeRefunded({
      id: 'ch_legacy_currency', payment_intent: 'pi_request_1', amount_refunded: 2500,
      currency: 'eur', refunds: { data: [] },
    })).rejects.toThrow(/currency/i);

    expect(h.state.payments).toEqual([legacy]);
    expect(h.folioService.recalculateBalance).not.toHaveBeenCalled();
  });

  it('rejects an instant-booking cumulative refund above the captured amount', async () => {
    const legacy = payment({
      bookingRequestId: null, folioId: FOLIO_ID, amount: '100.00', status: 'captured',
    });
    const h = await harness({ requests: [], payments: [legacy] });

    await expect(h.controller.handleChargeRefunded({
      id: 'ch_legacy_excess', payment_intent: 'pi_request_1', amount_refunded: 10001,
      currency: 'usd', refunds: { data: [] },
    })).rejects.toThrow(/exceed/i);

    expect(h.state.payments).toEqual([legacy]);
    expect(h.folioService.recalculateBalance).not.toHaveBeenCalled();
  });

  it('ignores a replay of the same cumulative instant-booking refund', async () => {
    const legacy = payment({
      bookingRequestId: null, folioId: FOLIO_ID, amount: '100.00', status: 'captured',
    });
    const h = await harness({ requests: [], payments: [legacy] });
    const charge = {
      id: 'ch_legacy_replay', payment_intent: 'pi_request_1', amount_refunded: 2500,
      currency: 'usd', refunds: { data: [] },
    };

    await h.controller.handleChargeRefunded(charge);
    await h.controller.handleChargeRefunded(charge);

    expect(h.state.payments.filter((row) => row.originalPaymentId === PAYMENT_ID)).toEqual([
      expect.objectContaining({ amount: '-25.00', status: 'captured' }),
    ]);
    expect(h.folioService.recalculateBalance).toHaveBeenCalledTimes(1);
    expect(h.webhookService.emit).toHaveBeenCalledTimes(1);
  });

  it('posts only the newly refunded portion when a cumulative instant-booking refund advances', async () => {
    const legacy = payment({
      bookingRequestId: null, folioId: FOLIO_ID, amount: '100.00', status: 'captured',
    });
    const h = await harness({ requests: [], payments: [legacy] });

    await h.controller.handleChargeRefunded({
      id: 'ch_legacy_progression', payment_intent: 'pi_request_1', amount_refunded: 2500,
      currency: 'usd', refunds: { data: [] },
    });
    await h.controller.handleChargeRefunded({
      id: 'ch_legacy_progression', payment_intent: 'pi_request_1', amount_refunded: 5000,
      currency: 'usd', refunds: { data: [] },
    });

    expect(h.state.payments.filter((row) => row.originalPaymentId === PAYMENT_ID)).toEqual([
      expect.objectContaining({ amount: '-25.00', status: 'captured' }),
      expect.objectContaining({ amount: '-25.00', status: 'captured' }),
    ]);
  });

  it('does not over-refund when an older cumulative instant-booking refund arrives late', async () => {
    const legacy = payment({
      bookingRequestId: null, folioId: FOLIO_ID, amount: '100.00', status: 'captured',
    });
    const h = await harness({ requests: [], payments: [legacy] });

    await h.controller.handleChargeRefunded({
      id: 'ch_legacy_out_of_order', payment_intent: 'pi_request_1', amount_refunded: 5000,
      currency: 'usd', refunds: { data: [] },
    });
    await h.controller.handleChargeRefunded({
      id: 'ch_legacy_out_of_order', payment_intent: 'pi_request_1', amount_refunded: 2500,
      currency: 'usd', refunds: { data: [] },
    });

    expect(h.state.payments.filter((row) => row.originalPaymentId === PAYMENT_ID)).toEqual([
      expect.objectContaining({ amount: '-50.00', status: 'captured' }),
    ]);
    expect(h.folioService.recalculateBalance).toHaveBeenCalledTimes(1);
    expect(h.webhookService.emit).toHaveBeenCalledTimes(1);
  });

  it('uses fresh acceptance folio for exact refund finalization and repairs allocation state', async () => {
    const claim = resolution('11111111-0000-4000-a000-000000000001');
    const h = await harness({
      requests: [request({ status: 'accepted', acceptedFolioId: FOLIO_ID })],
      resolutions: [claim],
    });
    await h.controller.handleRefundUpdated(refundEvent(claim.id, 're_after_accept'));
    expect(h.state.payments.find((row) => row.originalPaymentId === PAYMENT_ID)!.folioId).toBe(FOLIO_ID);
    expect(h.folioService.recalculateBalance).toHaveBeenCalledWith(FOLIO_ID, PROPERTY_ID, h.db);
    expect(reconcileBookingRequestPaymentAllocations).toHaveBeenCalled();
  });

  it('rejects missing correlation and scale-three refunds without ledger writes', async () => {
    const claim = resolution('11111111-0000-4000-a000-000000000001');
    const h = await harness({ resolutions: [claim] });
    await expect(h.controller.handleRefundUpdated({
      ...refundEvent(claim.id, 're_missing'), metadata: { haip_claim_id: claim.id },
    })).rejects.toThrow(/correlation metadata/i);
    await expect(h.controller.handleRefundUpdated({
      ...refundEvent(claim.id, 're_bhd', 'succeeded', 1000), currency: 'bhd',
    })).rejects.toThrow(/ledger storage precision/i);
    expect(h.state.payments).toHaveLength(1);
  });
});
