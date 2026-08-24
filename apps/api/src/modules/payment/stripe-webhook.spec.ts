import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import {
  auditLogs,
  bookingRequestConsequences,
  bookingRequestPaymentResolutions,
  bookingRequests,
  payments,
} from '@telivityhaip/database';
import { DRIZZLE } from '../../database/database.module';
import { FolioService } from '../folio/folio.service';
import { WebhookService } from '../webhook/webhook.service';
import { reconcileBookingRequestPaymentAllocations } from '../booking-request/booking-request-allocation-reconciler';
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
};

function request(overrides: Record<string, unknown> = {}) {
  return {
    id: REQUEST_ID,
    propertyId: PROPERTY_ID,
    status: 'pending',
    acceptedFolioId: null,
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
    originalPaymentId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
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

describe('StripeWebhookController financial finalization', () => {
  beforeEach(() => vi.clearAllMocks());

  it('keeps mock-mode HTTP behavior inert', async () => {
    const h = await harness();
    const response = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
    await h.controller.handleWebhook({}, response);
    expect(response.status).toHaveBeenCalledWith(200);
  });

  it('finalizes a pending request PaymentIntent under request→payment locks with fresh folio', async () => {
    const h = await harness({ requests: [request({ status: 'accepted', acceptedFolioId: FOLIO_ID })] });
    await h.controller.handlePaymentIntentSucceeded({ id: 'pi_request_1' });
    expect(h.state.payments[0]).toMatchObject({ status: 'captured', folioId: FOLIO_ID });
    expect(h.state.consequences).toEqual([
      expect.objectContaining({ kind: expect.stringMatching(/^payment_received:/), status: 'pending' }),
    ]);
    expect(h.folioService.recalculateBalance).toHaveBeenCalledWith(FOLIO_ID, PROPERTY_ID, h.db);
    expect(h.webhookService.emit).not.toHaveBeenCalled();
  });

  it('repairs a captured replay without duplicating its durable consequence', async () => {
    const h = await harness({
      requests: [request({ status: 'accepted', acceptedFolioId: FOLIO_ID })],
      payments: [payment({ status: 'captured', folioId: null })],
    });
    await h.controller.handlePaymentIntentSucceeded({ id: 'pi_request_1' });
    await h.controller.handlePaymentIntentSucceeded({ id: 'pi_request_1' });
    expect(h.state.payments[0]!.folioId).toBe(FOLIO_ID);
    expect(h.state.consequences).toHaveLength(1);
    expect(h.folioService.recalculateBalance).toHaveBeenCalledTimes(2);
  });

  it.each(['failed', 'voided'] as const)('does not regress terminal %s to captured', async (status) => {
    const h = await harness({ payments: [payment({ status })] });
    await h.controller.handlePaymentIntentSucceeded({ id: 'pi_request_1' });
    expect(h.state.payments[0]!.status).toBe(status);
    expect(h.state.consequences).toHaveLength(0);
    expect(h.state.audits).toEqual(expect.arrayContaining([
      expect.objectContaining({ description: expect.stringMatching(/unexpected/i) }),
    ]));
  });

  it('durably audits and rejects a capture reported after denial', async () => {
    const h = await harness({ requests: [request({ status: 'denied' })] });
    await expect(h.controller.handlePaymentIntentSucceeded({ id: 'pi_request_1' }))
      .rejects.toThrow(/denial|denied/i);
    expect(h.state.payments[0]!.status).toBe('pending');
    expect(h.state.audits).toHaveLength(1);
  });

  it('makes provider failure/requires-action terminal and emits a durable failed consequence', async () => {
    for (const method of ['handlePaymentIntentFailed', 'handlePaymentIntentRequiresAction']) {
      const h = await harness();
      await h.controller[method]({ id: 'pi_request_1', last_payment_error: { message: 'Declined' } });
      expect(h.state.payments[0]!.status).toBe('failed');
      expect(h.state.consequences[0]!.kind).toMatch(/^payment_failed:/);
      await h.controller.handlePaymentIntentSucceeded({ id: 'pi_request_1' });
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

  it('preserves a legacy payment when charge.refunded includes uncorrelated refund objects', async () => {
    const legacy = payment({ bookingRequestId: null, folioId: FOLIO_ID });
    const h = await harness({ requests: [], payments: [legacy] });
    await h.controller.handleChargeRefunded({
      id: 'ch_legacy',
      payment_intent: 'pi_request_1',
      amount_refunded: 2500,
      currency: 'usd',
      refunds: {
        data: [{
          id: 're_legacy', status: 'succeeded', amount: 2500, currency: 'usd', metadata: {},
        }],
      },
    });
    expect(h.state.payments).toEqual([legacy]);
    expect(h.folioService.recalculateBalance).toHaveBeenCalledWith(FOLIO_ID, PROPERTY_ID, h.db);
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
