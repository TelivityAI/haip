import { ConflictException, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  auditLogs,
  bookingRequestConsequences,
  bookingRequestEmailDeliveries,
  bookingRequestInstallments,
  bookingRequestPaymentAllocations,
  bookingRequestPaymentResolutions,
  bookingRequests,
  payments,
} from '@telivityhaip/database';
import { WEBHOOK_EVENTS, type WebhookEvent } from '@telivityhaip/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PERMISSIONS_KEY } from '../auth/permissions.decorator';
import { BookingRequestController } from './booking-request.controller';
import { BookingRequestPaymentService } from './booking-request-payment.service';
import {
  AllocateBookingRequestPaymentDto,
  ChargeBookingRequestCardDto,
  CreateBookingRequestInstallmentDto,
  RecordBookingRequestExternalPaymentDto,
  RecordBookingRequestExternalReturnDto,
  RefundBookingRequestPaymentDto,
  RetainBookingRequestPaymentDto,
} from './dto/booking-request-payment.dto';

const PROPERTY_ID = 'aaaaaaaa-0000-4000-a000-000000000001';
const OTHER_PROPERTY_ID = 'aaaaaaaa-0000-4000-a000-000000000002';
const REQUEST_ID = 'bbbbbbbb-0000-4000-a000-000000000001';
const FOLIO_ID = 'cccccccc-0000-4000-a000-000000000001';
const PAYMENT_ID = 'dddddddd-0000-4000-a000-000000000001';
const INSTALLMENT_ID = 'eeeeeeee-0000-4000-a000-000000000001';

type State = {
  requests: Array<Record<string, any>>;
  installments: Array<Record<string, any>>;
  payments: Array<Record<string, any>>;
  allocations: Array<Record<string, any>>;
  resolutions: Array<Record<string, any>>;
  audits: Array<Record<string, any>>;
  consequences: Array<Record<string, any>>;
  emails: Array<Record<string, any>>;
};

function request(overrides: Record<string, unknown> = {}) {
  return {
    id: REQUEST_ID,
    propertyId: PROPERTY_ID,
    status: 'pending',
    currencyCode: 'EUR',
    submittedQuoteSnapshot: { grandTotal: '220.00' },
    acceptedTotal: null,
    acceptedFolioId: null,
    stripeCustomerId: 'cus_saved',
    stripePaymentMethodId: 'pm_saved',
    cardLastFour: '4242',
    cardBrand: 'visa',
    guestFirstName: 'Ada',
    guestEmail: 'ada@example.com',
    ...overrides,
  };
}

function installment(overrides: Record<string, unknown> = {}) {
  return {
    id: INSTALLMENT_ID,
    propertyId: PROPERTY_ID,
    bookingRequestId: REQUEST_ID,
    label: 'Deposit',
    sortOrder: 0,
    fixedAmount: '100.00',
    percentage: null,
    resolvedAmount: '100.00',
    dueMilestone: 'manual',
    dueDate: null,
    allocatedAmount: '0.00',
    status: 'unpaid',
    createdAt: new Date('2026-08-24T10:00:00.000Z'),
    updatedAt: new Date('2026-08-24T10:00:00.000Z'),
    ...overrides,
  };
}

function capturedPayment(overrides: Record<string, unknown> = {}) {
  return {
    id: PAYMENT_ID,
    propertyId: PROPERTY_ID,
    bookingRequestId: REQUEST_ID,
    folioId: null,
    houseAccountId: null,
    idempotencyKey: 'booking-request-external:existing',
    method: 'cash',
    status: 'captured',
    amount: '100.00',
    currencyCode: 'EUR',
    gatewayProvider: 'external',
    gatewayTransactionId: 'receipt-1',
    originalPaymentId: null,
    processedAt: new Date('2026-08-20T10:00:00.000Z'),
    createdAt: new Date('2026-08-24T10:00:00.000Z'),
    updatedAt: new Date('2026-08-24T10:00:00.000Z'),
    ...overrides,
  };
}

function tableRows(state: State, table: unknown): Array<Record<string, any>> {
  if (table === bookingRequests) return state.requests;
  if (table === bookingRequestInstallments) return state.installments;
  if (table === payments) return state.payments;
  if (table === bookingRequestPaymentAllocations) return state.allocations;
  if (table === bookingRequestPaymentResolutions) return state.resolutions;
  if (table === auditLogs) return state.audits;
  if (table === bookingRequestConsequences) return state.consequences;
  if (table === bookingRequestEmailDeliveries) return state.emails;
  throw new Error('Unexpected table in payment test');
}

function makeDatabase(state: State) {
  let sequence = 10;
  let transactionActive = false;
  let lockCalls = 0;

  const select = vi.fn(() => {
    let table: unknown;
    const rows = () => structuredClone(tableRows(state, table));
    const chain: Record<string, any> & PromiseLike<any> = {
      from: vi.fn((selected: unknown) => {
        table = selected;
        return chain;
      }),
      where: vi.fn(() => chain),
      orderBy: vi.fn(() => chain),
      for: vi.fn(async () => {
        lockCalls += 1;
        return rows();
      }),
      then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) =>
        Promise.resolve(rows()).then(resolve, reject),
    };
    return chain;
  });

  const insert = vi.fn((table: unknown) => ({
    values: vi.fn((input: Record<string, unknown>) => {
      let inserted: Record<string, unknown> | undefined;
      let didAttempt = false;
      const doInsert = (ignoreConflict: boolean) => {
        if (didAttempt) return inserted ? [structuredClone(inserted)] : [];
        didAttempt = true;
        const rows = tableRows(state, table);
        if (table === payments && input['idempotencyKey'] != null) {
          const duplicate = rows.some((row) =>
            row.propertyId === input['propertyId']
            && row.idempotencyKey === input['idempotencyKey']);
          if (duplicate) {
            if (ignoreConflict) return [];
            throw new Error('duplicate payments_property_idempotency_key_unique');
          }
        }
        if (table === bookingRequestPaymentAllocations) {
          const duplicate = rows.some((row) =>
            row.paymentId === input['paymentId']
            && row.installmentId === input['installmentId']);
          if (duplicate) {
            if (ignoreConflict) return [];
            throw new Error('duplicate payment allocation');
          }
        }
        if (table === bookingRequestConsequences) {
          const duplicate = rows.some((row) =>
            row.propertyId === input['propertyId']
            && row.bookingRequestId === input['bookingRequestId']
            && row.kind === input['kind']);
          if (duplicate) {
            if (ignoreConflict) return [];
            throw new Error('duplicate booking request consequence');
          }
        }
        if (table === bookingRequestEmailDeliveries) {
          const duplicate = rows.some((row) =>
            row.propertyId === input['propertyId']
            && row.bookingRequestId === input['bookingRequestId']
            && row.logicalKey === input['logicalKey']);
          if (duplicate) {
            if (ignoreConflict) return [];
            throw new Error('duplicate booking request email');
          }
        }
        sequence += 1;
        inserted = {
          id: input['id'] ?? `00000000-0000-4000-a000-${String(sequence).padStart(12, '0')}`,
          ...structuredClone(input),
          createdAt: input['createdAt'] ?? new Date(),
          updatedAt: input['updatedAt'] ?? new Date(),
        };
        rows.push(inserted);
        return [structuredClone(inserted)];
      };
      const result: Record<string, any> & PromiseLike<any> = {
        returning: vi.fn(async () => doInsert(false)),
        onConflictDoNothing: vi.fn(() => ({
          returning: vi.fn(async () => doInsert(true)),
          then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) =>
            Promise.resolve().then(() => doInsert(true)).then(resolve, reject),
        })),
        then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) =>
          Promise.resolve().then(() => doInsert(false)).then(resolve, reject),
      };
      return result;
    }),
  }));

  const update = vi.fn((table: unknown) => ({
    set: vi.fn((changes: Record<string, unknown>) => ({
      where: vi.fn(() => {
        const apply = () => {
          const rows = tableRows(state, table);
          for (const row of rows) Object.assign(row, structuredClone(changes));
          return structuredClone(rows);
        };
        const chain: Record<string, any> & PromiseLike<any> = {
          returning: vi.fn(async () => apply()),
          then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) =>
            Promise.resolve(apply()).then(resolve, reject),
        };
        return chain;
      }),
    })),
  }));

  const remove = vi.fn((table: unknown) => ({
    where: vi.fn(async () => {
      const rows = tableRows(state, table);
      rows.splice(0, rows.length);
    }),
  }));

  const db: Record<string, any> = { select, insert, update, delete: remove };
  db['transaction'] = vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => {
    const snapshot = structuredClone(state);
    transactionActive = true;
    try {
      return await callback(db);
    } catch (error) {
      for (const key of Object.keys(state) as Array<keyof State>) {
        state[key].splice(0, state[key].length, ...snapshot[key]);
      }
      throw error;
    } finally {
      transactionActive = false;
    }
  });

  return {
    db,
    isTransactionActive: () => transactionActive,
    get lockCalls() {
      return lockCalls;
    },
  };
}

function makeHarness(overrides: Partial<State> = {}) {
  const state: State = {
    requests: [request()],
    installments: [],
    payments: [],
    allocations: [],
    resolutions: [],
    audits: [],
    consequences: [],
    emails: [],
    ...structuredClone(overrides),
  };
  const database = makeDatabase(state);
  const gatewayTransactionStates: boolean[] = [];
  const gateway = {
    charge: vi.fn(async () => {
      gatewayTransactionStates.push(database.isTransactionActive());
      return {
        success: true,
        transactionId: 'pi_saved_1',
        requiresAction: false,
      };
    }),
  };
  const refundGateway = {
    refund: vi.fn().mockResolvedValue({
      success: true,
      transactionId: 're_gateway_1',
    }),
  };
  const folioService = {
    recalculateBalance: vi.fn(),
  };
  const mailer = {
    deliverForRequestBestEffort: vi.fn().mockResolvedValue(undefined),
  };
  const service = new (BookingRequestPaymentService as any)(
    database.db,
    gateway,
    folioService,
    refundGateway,
    mailer,
  ) as BookingRequestPaymentService;
  return {
    service,
    state,
    database,
    gateway,
    folioService,
    refundGateway,
    mailer,
    gatewayTransactionStates,
  };
}

const actor = {
  userId: 'ffffffff-0000-4000-a000-000000000001',
  userEmail: 'agent@example.com',
  ipAddress: '203.0.113.8',
};

describe('Booking Request payment HTTP contract', () => {
  it('requires reservations.write for every payment-plan and money mutation', () => {
    const reflector = new Reflector();
    expect(reflector.get(
      PERMISSIONS_KEY,
      BookingRequestController.prototype.listPayments,
    )).toEqual(['reservations.read']);
    for (const method of [
      'createInstallment',
      'updateInstallment',
      'deleteInstallment',
      'allocatePayment',
      'chargeSavedCard',
      'recordExternalPayment',
      'refundPayment',
      'recordExternalReturn',
      'retainForDenial',
    ] as const) {
      expect(reflector.get(
        PERMISSIONS_KEY,
        BookingRequestController.prototype[method],
      )).toEqual(['reservations.write']);
    }
  });

  it('validates positive amounts, UUIDs, milestones, dates, and references in concrete DTOs', async () => {
    const validInstallment = plainToInstance(CreateBookingRequestInstallmentDto, {
      label: 'Arrival balance',
      percentage: '70.00',
      sortOrder: 1,
      dueMilestone: 'arrival',
    });
    expect(await validate(validInstallment)).toHaveLength(0);
    expect(await validate(plainToInstance(CreateBookingRequestInstallmentDto, {
      label: 'Whole balance',
      percentage: '100.00',
      dueMilestone: 'manual',
    }))).toHaveLength(0);
    expect(await validate(plainToInstance(CreateBookingRequestInstallmentDto, {
      label: 'Too much',
      percentage: '100.01',
      dueMilestone: 'manual',
    }))).not.toHaveLength(0);

    for (const [Dto, value] of [
      [AllocateBookingRequestPaymentDto, { paymentId: 'not-a-uuid', amount: '0' }],
      [ChargeBookingRequestCardDto, { amount: '-1.00', idempotencyKey: '' }],
      [RecordBookingRequestExternalPaymentDto, {
        amount: '0', method: 'cash', currencyCode: 'EUR',
        processedAt: 'not-a-date', reference: '',
      }],
      [RefundBookingRequestPaymentDto, { amount: '0', idempotencyKey: '' }],
      [RecordBookingRequestExternalReturnDto, {
        amount: '-1.00', processedAt: 'not-a-date', reference: '',
      }],
      [RetainBookingRequestPaymentDto, { amount: '0', reason: '' }],
    ] as const) {
      expect((await validate(plainToInstance(Dto as any, value))).length).toBeGreaterThan(0);
    }
  });
});

describe('BookingRequestPaymentService installments', () => {
  it('resolves fixed and percentage installments and treats all milestones as labels only', async () => {
    const harness = makeHarness();
    const inputs = [
      { label: 'Manual deposit', fixedAmount: '44.00', dueMilestone: 'manual' as const },
      { label: 'Dated payment', percentage: '30.00', dueMilestone: 'date' as const, dueDate: '2026-09-01' },
      { label: 'Arrival', fixedAmount: '50.00', dueMilestone: 'arrival' as const },
      { label: 'Checkout', fixedAmount: '60.00', dueMilestone: 'checkout' as const },
    ];

    const created = [];
    for (const input of inputs) {
      created.push(await harness.service.createInstallment(
        REQUEST_ID,
        PROPERTY_ID,
        input,
        actor,
      ));
    }

    expect(created.map((row) => row.resolvedAmount)).toEqual([
      '44.00',
      '66.00',
      '50.00',
      '60.00',
    ]);
    expect(created.map((row) => row.dueMilestone)).toEqual([
      'manual',
      'date',
      'arrival',
      'checkout',
    ]);
    expect(harness.gateway.charge).not.toHaveBeenCalled();
    expect(harness.state.payments).toHaveLength(0);
  });

  it('rejects invalid amount definitions and a dated milestone without a due date', async () => {
    const harness = makeHarness();
    await expect(harness.service.createInstallment(REQUEST_ID, PROPERTY_ID, {
      label: 'Invalid',
      fixedAmount: '0',
      dueMilestone: 'manual',
    }, actor)).rejects.toBeInstanceOf(ConflictException);
    await expect(harness.service.createInstallment(REQUEST_ID, PROPERTY_ID, {
      label: 'Invalid',
      fixedAmount: '10.00',
      percentage: '10.00',
      dueMilestone: 'manual',
    }, actor)).rejects.toThrow(/exactly one/i);
    await expect(harness.service.createInstallment(REQUEST_ID, PROPERTY_ID, {
      label: 'Dated',
      fixedAmount: '10.00',
      dueMilestone: 'date',
    }, actor)).rejects.toThrow(/due date/i);
    await expect(harness.service.createInstallment(REQUEST_ID, PROPERTY_ID, {
      label: 'Over one hundred percent',
      percentage: '100.01',
      dueMilestone: 'manual',
    }, actor)).rejects.toThrow(/100/i);
  });

  it('uses ISO zero-decimal rounding and rejects installments for a zero-total request', async () => {
    const jpy = makeHarness({
      requests: [request({
        currencyCode: 'JPY',
        submittedQuoteSnapshot: { grandTotal: '101' },
      })],
    });
    const rounded = await jpy.service.createInstallment(REQUEST_ID, PROPERTY_ID, {
      label: 'Half',
      percentage: '50',
      dueMilestone: 'manual',
    }, actor);
    expect(rounded.resolvedAmount).toBe('51.00');

    const zeroTotal = makeHarness({
      requests: [request({ submittedQuoteSnapshot: { grandTotal: '0.00' } })],
    });
    await expect(zeroTotal.service.createInstallment(REQUEST_ID, PROPERTY_ID, {
      label: 'Invalid plan',
      fixedAmount: '10.00',
      dueMilestone: 'manual',
    }, actor)).rejects.toThrow(/zero-total|positive total/i);
  });

  it('adds partial allocations under locks and recomputes unpaid, partial, and paid state', async () => {
    const harness = makeHarness({
      installments: [installment()],
      payments: [
        capturedPayment({ id: PAYMENT_ID, amount: '30.00' }),
        capturedPayment({
          id: 'dddddddd-0000-4000-a000-000000000002',
          amount: '70.00',
          gatewayTransactionId: 'receipt-2',
          idempotencyKey: 'booking-request-external:second',
        }),
      ],
    });

    const partial = await harness.service.allocatePayment(
      REQUEST_ID,
      INSTALLMENT_ID,
      PROPERTY_ID,
      { paymentId: PAYMENT_ID, amount: '10.00' },
      actor,
    );
    expect(partial.installment).toMatchObject({ allocatedAmount: '10.00', status: 'partial' });

    const sameMovement = await harness.service.allocatePayment(
      REQUEST_ID,
      INSTALLMENT_ID,
      PROPERTY_ID,
      { paymentId: PAYMENT_ID, amount: '20.00' },
      actor,
    );
    expect(sameMovement.allocation.amount).toBe('30.00');
    expect(harness.state.allocations).toHaveLength(1);

    const paid = await harness.service.allocatePayment(
      REQUEST_ID,
      INSTALLMENT_ID,
      PROPERTY_ID,
      { paymentId: 'dddddddd-0000-4000-a000-000000000002', amount: '70.00' },
      actor,
    );
    expect(paid.installment).toMatchObject({ allocatedAmount: '100.00', status: 'paid' });
    expect(harness.database.lockCalls).toBeGreaterThanOrEqual(6);
  });

  it('rejects allocation for a zero-total request even when legacy rows already exist', async () => {
    const harness = makeHarness({
      requests: [request({ submittedQuoteSnapshot: { grandTotal: '0.00' } })],
      installments: [installment()],
      payments: [capturedPayment({ amount: '100.00' })],
    });

    await expect(harness.service.allocatePayment(
      REQUEST_ID,
      INSTALLMENT_ID,
      PROPERTY_ID,
      { paymentId: PAYMENT_ID, amount: '10.00' },
      actor,
    )).rejects.toThrow(/zero-total|positive total/i);
    expect(harness.state.allocations).toHaveLength(0);
  });

  it('allocates only the canonical net captured amount after returns', async () => {
    const parent = capturedPayment({ amount: '100.00' });
    const returned = capturedPayment({
      id: 'dddddddd-0000-4000-a000-000000000099',
      amount: '-40.00',
      originalPaymentId: PAYMENT_ID,
      idempotencyKey: 'booking-request-external-return:existing',
    });
    const harness = makeHarness({
      installments: [installment({ resolvedAmount: '100.00' })],
      payments: [parent, returned],
    });

    await expect(harness.service.allocatePayment(
      REQUEST_ID,
      INSTALLMENT_ID,
      PROPERTY_ID,
      { paymentId: PAYMENT_ID, amount: '60.01' },
      actor,
    )).rejects.toThrow(/movement/i);
    await harness.service.allocatePayment(
      REQUEST_ID,
      INSTALLMENT_ID,
      PROPERTY_ID,
      { paymentId: PAYMENT_ID, amount: '60.00' },
      actor,
    );
    await expect(harness.service.allocatePayment(
      REQUEST_ID,
      INSTALLMENT_ID,
      PROPERTY_ID,
      { paymentId: PAYMENT_ID, amount: '0.01' },
      actor,
    )).rejects.toThrow(/movement/i);
  });

  it('blocks editing and deletion after any amount has been allocated', async () => {
    const allocated = installment({ allocatedAmount: '1.00', status: 'partial' });
    const editHarness = makeHarness({ installments: [allocated] });
    await expect(editHarness.service.updateInstallment(
      REQUEST_ID,
      INSTALLMENT_ID,
      PROPERTY_ID,
      { label: 'Changed' },
      actor,
    )).rejects.toThrow(/allocated/i);

    const deleteHarness = makeHarness({ installments: [allocated] });
    await expect(deleteHarness.service.deleteInstallment(
      REQUEST_ID,
      INSTALLMENT_ID,
      PROPERTY_ID,
      actor,
    )).rejects.toThrow(/allocated/i);
  });

  it('uses locked allocation rows rather than a stale cached allocated amount', async () => {
    const harness = makeHarness({
      installments: [installment({ allocatedAmount: '0.00', status: 'unpaid' })],
      allocations: [{
        id: '00000000-0000-4000-a000-000000000020',
        propertyId: PROPERTY_ID,
        bookingRequestId: REQUEST_ID,
        paymentId: PAYMENT_ID,
        installmentId: INSTALLMENT_ID,
        amount: '1.00',
      }],
    });

    await expect(harness.service.updateInstallment(
      REQUEST_ID,
      INSTALLMENT_ID,
      PROPERTY_ID,
      { label: 'Must stay unchanged' },
      actor,
    )).rejects.toThrow(/allocated/i);
  });

  it('returns not found for a cross-property installment', async () => {
    const harness = makeHarness({
      installments: [installment({ propertyId: OTHER_PROPERTY_ID })],
    });
    await expect(harness.service.updateInstallment(
      REQUEST_ID,
      INSTALLMENT_ID,
      PROPERTY_ID,
      { label: 'Changed' },
      actor,
    )).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('BookingRequestPaymentService saved-card charges', () => {
  it('commits pending before calling the gateway and captures against the request', async () => {
    const harness = makeHarness();
    const result = await harness.service.chargeSavedCard(
      REQUEST_ID,
      PROPERTY_ID,
      { amount: '80.25', idempotencyKey: 'staff-charge-1' },
      actor,
    );

    expect(harness.gatewayTransactionStates).toEqual([false]);
    expect(harness.gateway.charge).toHaveBeenCalledWith(expect.objectContaining({
      customerId: 'cus_saved',
      paymentMethodId: 'pm_saved',
      paymentId: result.id,
      propertyId: PROPERTY_ID,
      bookingRequestId: REQUEST_ID,
      amount: '80.25',
      currencyCode: 'EUR',
      idempotencyKey: expect.stringContaining('booking-request-charge:'),
    }));
    expect(result).toMatchObject({
      propertyId: PROPERTY_ID,
      bookingRequestId: REQUEST_ID,
      folioId: null,
      amount: '80.25',
      status: 'captured',
    });
    expect(result).not.toHaveProperty('gatewayPaymentToken');
    expect(result).not.toHaveProperty('idempotencyKey');
    expect(result).not.toHaveProperty('gatewayTransactionId');
    expect(harness.state.consequences).toEqual([
      expect.objectContaining({ kind: expect.stringMatching(/^payment_received:/) }),
    ]);
    expect(harness.state.emails).toEqual([
      expect.objectContaining({
        logicalKey: expect.stringMatching(/^payment:/),
        kind: 'payment',
        status: 'pending',
        recipient: 'ada@example.com',
        automaticAttempts: 0,
        nextAttemptAt: expect.any(Date),
      }),
    ]);
    expect(harness.state.audits).toContainEqual(expect.objectContaining({
      entityType: 'booking_request_email_delivery',
      description: 'Booking request payment email queued',
    }));
    expect(JSON.stringify(harness.state.emails)).not.toMatch(
      /cus_saved|pm_saved|pi_saved|booking-request-charge|https?:\/\//i,
    );
    expect(harness.mailer.deliverForRequestBestEffort).toHaveBeenCalledWith(
      REQUEST_ID,
      PROPERTY_ID,
    );
  });

  it('returns a webhook-recovered capture on later API replay without another provider call', async () => {
    const harness = makeHarness();
    const input = { amount: '25.00', idempotencyKey: 'crash-before-provider-id-commit' };
    harness.gateway.charge.mockRejectedValueOnce(new Error('process stopped after provider create'));

    await expect(harness.service.chargeSavedCard(
      REQUEST_ID, PROPERTY_ID, input, actor,
    )).rejects.toThrow(/same idempotency key|unknown/i);
    expect(harness.state.payments[0]!.status).toBe('pending');
    expect(harness.state.payments[0]!.gatewayTransactionId).toBeFalsy();

    Object.assign(harness.state.payments[0]!, {
      status: 'captured',
      gatewayTransactionId: 'pi_recovered_by_signed_webhook',
      processedAt: new Date(),
    });
    const replay = await harness.service.chargeSavedCard(
      REQUEST_ID, PROPERTY_ID, input, actor,
    );

    expect(replay).toMatchObject({ status: 'captured', id: harness.state.payments[0]!.id });
    expect(harness.gateway.charge).toHaveBeenCalledTimes(1);
  });

  it('returns the existing result for a stable key without calling the gateway again', async () => {
    const harness = makeHarness();
    const first = await harness.service.chargeSavedCard(
      REQUEST_ID,
      PROPERTY_ID,
      { amount: '40.00', idempotencyKey: 'same-charge' },
      actor,
    );
    const second = await harness.service.chargeSavedCard(
      REQUEST_ID,
      PROPERTY_ID,
      { amount: '40.00', idempotencyKey: 'same-charge' },
      actor,
    );
    expect(second.id).toBe(first.id);
    expect(harness.gateway.charge).toHaveBeenCalledTimes(1);
  });

  it('repairs folio balance recalculation when a captured charge is replayed', async () => {
    const harness = makeHarness({
      requests: [request({
        status: 'accepted',
        acceptedTotal: '220.00',
        acceptedFolioId: FOLIO_ID,
      })],
    });
    const input = { amount: '40.00', idempotencyKey: 'charge-recalc-replay' };
    await harness.service.chargeSavedCard(REQUEST_ID, PROPERTY_ID, input, actor);
    harness.folioService.recalculateBalance.mockClear();

    await harness.service.chargeSavedCard(REQUEST_ID, PROPERTY_ID, input, actor);

    expect(harness.folioService.recalculateBalance).toHaveBeenCalledWith(
      FOLIO_ID,
      PROPERTY_ID,
      expect.anything(),
    );
    expect(harness.gateway.charge).toHaveBeenCalledTimes(1);
  });

  it('keeps an unknown gateway result pending and resumes with the same provider key', async () => {
    const harness = makeHarness();
    harness.gateway.charge
      .mockRejectedValueOnce(new Error('socket timed out after provider capture'))
      .mockResolvedValueOnce({
        success: true,
        transactionId: 'pi_recovered',
        requiresAction: false,
      });

    await expect(harness.service.chargeSavedCard(
      REQUEST_ID,
      PROPERTY_ID,
      { amount: '40.00', idempotencyKey: 'timeout-after-capture' },
      actor,
    )).rejects.toThrow(/unknown|retry/i);
    expect(harness.state.payments).toHaveLength(1);
    expect(harness.state.payments[0]).toMatchObject({ status: 'pending' });

    const recovered = await harness.service.chargeSavedCard(
      REQUEST_ID,
      PROPERTY_ID,
      { amount: '40.00', idempotencyKey: 'timeout-after-capture' },
      actor,
    );
    expect(recovered).toMatchObject({ status: 'captured' });
    expect(recovered).not.toHaveProperty('gatewayTransactionId');
    const keys = harness.gateway.charge.mock.calls.map((call) => call[0].idempotencyKey);
    expect(keys).toHaveLength(2);
    expect(new Set(keys).size).toBe(1);
  });

  it('persists a processing PaymentIntent identity while leaving the charge pending', async () => {
    const harness = makeHarness();
    harness.gateway.charge.mockResolvedValueOnce({
      success: false,
      transactionId: 'pi_processing',
      requiresAction: false,
      indeterminate: true,
      providerStatus: 'processing',
      errorMessage: 'Payment is processing',
    });

    await expect(harness.service.chargeSavedCard(
      REQUEST_ID,
      PROPERTY_ID,
      { amount: '40.00', idempotencyKey: 'processing-identity' },
      actor,
    )).rejects.toThrow(/pending|retry|processing/i);
    expect(harness.state.payments[0]).toMatchObject({
      status: 'pending',
      gatewayTransactionId: 'pi_processing',
    });
  });

  it('resumes concurrent callers of the same pending charge with one provider identity', async () => {
    const harness = makeHarness();
    let release!: (value: {
      success: true;
      transactionId: string;
      requiresAction: false;
    }) => void;
    const providerResult = new Promise<{
      success: true;
      transactionId: string;
      requiresAction: false;
    }>((resolve) => { release = resolve; });
    harness.gateway.charge.mockImplementation(() => providerResult);

    const first = harness.service.chargeSavedCard(
      REQUEST_ID,
      PROPERTY_ID,
      { amount: '40.00', idempotencyKey: 'concurrent-charge' },
      actor,
    );
    await vi.waitFor(() => expect(harness.gateway.charge).toHaveBeenCalledTimes(1));
    const second = harness.service.chargeSavedCard(
      REQUEST_ID,
      PROPERTY_ID,
      { amount: '40.00', idempotencyKey: 'concurrent-charge' },
      actor,
    );
    await vi.waitFor(() => expect(harness.gateway.charge).toHaveBeenCalledTimes(2));
    release({ success: true, transactionId: 'pi_concurrent', requiresAction: false });

    const results = await Promise.all([first, second]);
    expect(results.every((result) => result.status === 'captured')).toBe(true);
    const keys = harness.gateway.charge.mock.calls.map((call) => call[0].idempotencyKey);
    expect(new Set(keys).size).toBe(1);
  });

  it('uses the freshly locked accepted folio when capture finishes after acceptance', async () => {
    const harness = makeHarness();
    let release!: (value: {
      success: true;
      transactionId: string;
      requiresAction: false;
    }) => void;
    harness.gateway.charge.mockImplementation(() => new Promise((resolve) => {
      release = resolve;
    }));

    const charging = harness.service.chargeSavedCard(
      REQUEST_ID,
      PROPERTY_ID,
      { amount: '40.00', idempotencyKey: 'accept-during-charge' },
      actor,
    );
    await vi.waitFor(() => expect(harness.gateway.charge).toHaveBeenCalledTimes(1));
    Object.assign(harness.state.requests[0], {
      status: 'accepted',
      acceptedTotal: '220.00',
      acceptedFolioId: FOLIO_ID,
    });
    release({ success: true, transactionId: 'pi_after_accept', requiresAction: false });

    const result = await charging;
    expect(result).toMatchObject({ status: 'captured', folioId: FOLIO_ID });
    expect(harness.folioService.recalculateBalance).toHaveBeenCalledWith(
      FOLIO_ID,
      PROPERTY_ID,
      expect.anything(),
    );
  });

  it('never finalizes capture after the request becomes denied', async () => {
    const harness = makeHarness();
    let release!: (value: {
      success: true;
      transactionId: string;
      requiresAction: false;
    }) => void;
    harness.gateway.charge.mockImplementation(() => new Promise((resolve) => {
      release = resolve;
    }));
    const charging = harness.service.chargeSavedCard(
      REQUEST_ID,
      PROPERTY_ID,
      { amount: '40.00', idempotencyKey: 'denial-race' },
      actor,
    );
    await vi.waitFor(() => expect(harness.gateway.charge).toHaveBeenCalledTimes(1));
    harness.state.requests[0]!.status = 'denied';
    release({ success: true, transactionId: 'pi_denial_race', requiresAction: false });

    await expect(charging).rejects.toThrow(/denied/i);
    expect(harness.state.payments[0]).toMatchObject({ status: 'pending' });
  });

  it('scopes the gateway idempotency identity by property', async () => {
    const firstProperty = makeHarness();
    const secondProperty = makeHarness({
      requests: [request({ propertyId: OTHER_PROPERTY_ID })],
    });

    await firstProperty.service.chargeSavedCard(
      REQUEST_ID,
      PROPERTY_ID,
      { amount: '40.00', idempotencyKey: 'shared-client-key' },
      actor,
    );
    await secondProperty.service.chargeSavedCard(
      REQUEST_ID,
      OTHER_PROPERTY_ID,
      { amount: '40.00', idempotencyKey: 'shared-client-key' },
      actor,
    );

    const firstKey = firstProperty.gateway.charge.mock.calls[0]?.[0].idempotencyKey;
    const secondKey = secondProperty.gateway.charge.mock.calls[0]?.[0].idempotencyKey;
    expect(firstKey).not.toBe(secondKey);
  });

  it('records gateway decline and additional-authentication outcomes as terminal failures', async () => {
    for (const gatewayResult of [
      { success: false, transactionId: 'pi_declined', requiresAction: false, errorMessage: 'Declined' },
      {
        success: false,
        transactionId: 'pi_auth',
        requiresAction: true,
        errorMessage: 'Payment requires additional authentication',
      },
    ]) {
      const harness = makeHarness();
      harness.gateway.charge.mockResolvedValueOnce(gatewayResult);
      const result = await harness.service.chargeSavedCard(
        REQUEST_ID,
        PROPERTY_ID,
        { amount: '25.00', idempotencyKey: gatewayResult.transactionId },
        actor,
      );
      expect(result.status).toBe('failed');
      expect(result).not.toHaveProperty('gatewayTransactionId');
      expect(JSON.stringify(result)).not.toMatch(/client_secret|authentication_url|https?:\/\//i);
      expect(harness.state.consequences).toEqual([
        expect.objectContaining({ kind: expect.stringMatching(/^payment_failed:/) }),
      ]);
      expect(harness.state.emails).toEqual([
        expect.objectContaining({ kind: 'failure', logicalKey: expect.stringMatching(/^failure:/) }),
      ]);
    }
  });

  it('links a new charge to the accepted folio and recalculates only after capture', async () => {
    const harness = makeHarness({
      requests: [request({
        status: 'accepted',
        acceptedTotal: '220.00',
        acceptedFolioId: FOLIO_ID,
      })],
    });
    const result = await harness.service.chargeSavedCard(
      REQUEST_ID,
      PROPERTY_ID,
      { amount: '30.00', idempotencyKey: 'after-acceptance' },
      actor,
    );
    expect(result).toMatchObject({ bookingRequestId: REQUEST_ID, folioId: FOLIO_ID });
    expect(harness.folioService.recalculateBalance).toHaveBeenCalledWith(
      FOLIO_ID,
      PROPERTY_ID,
      expect.anything(),
    );
  });

  it('rejects zero total, missing card, denied request, and cross-property scope before gateway side effects', async () => {
    for (const row of [
      request({ submittedQuoteSnapshot: { grandTotal: '0.00' } }),
      request({ stripeCustomerId: null, stripePaymentMethodId: null }),
      request({ status: 'denied' }),
      request({ propertyId: OTHER_PROPERTY_ID }),
    ]) {
      const harness = makeHarness({ requests: [row] });
      await expect(harness.service.chargeSavedCard(
        REQUEST_ID,
        PROPERTY_ID,
        { amount: '10.00', idempotencyKey: 'blocked' },
        actor,
      )).rejects.toThrow();
      expect(harness.gateway.charge).not.toHaveBeenCalled();
      expect(harness.state.payments).toHaveLength(0);
    }
  });

  it('rejects currencies whose minor units exceed the scale-two ledger before gateway I/O', async () => {
    const harness = makeHarness({
      requests: [request({
        currencyCode: 'BHD',
        submittedQuoteSnapshot: { grandTotal: '100.000' },
      })],
    });

    await expect(harness.service.chargeSavedCard(
      REQUEST_ID,
      PROPERTY_ID,
      { amount: '1.00', idempotencyKey: 'unsupported-bhd' },
      actor,
    )).rejects.toThrow(/ledger.*precision|unsupported.*BHD/i);
    expect(harness.gateway.charge).not.toHaveBeenCalled();
    expect(harness.state.payments).toHaveLength(0);
  });
});

describe('BookingRequestPaymentService external movements and denial resolutions', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it('lists request-scoped movements, allocations, and resolutions for staff detail', async () => {
    const harness = makeHarness({
      payments: [
        capturedPayment(),
        capturedPayment({
          id: 'dddddddd-0000-4000-a000-000000000009',
          propertyId: OTHER_PROPERTY_ID,
        }),
      ],
      allocations: [{
        id: '00000000-0000-4000-a000-000000000011',
        propertyId: PROPERTY_ID,
        bookingRequestId: REQUEST_ID,
        paymentId: PAYMENT_ID,
        installmentId: INSTALLMENT_ID,
        amount: '10.00',
      }],
      resolutions: [{
        id: '00000000-0000-4000-a000-000000000012',
        propertyId: PROPERTY_ID,
        bookingRequestId: REQUEST_ID,
        paymentId: PAYMENT_ID,
        type: 'retained',
        status: 'completed',
        amount: '10.00',
        reason: 'Supplier fee',
        idempotencyKey: 'internal-resolution-key',
        operationFingerprint: 'internal-fingerprint',
        providerTransactionId: 're_internal',
        providerStatus: 'succeeded',
      }],
    });

    const result = await harness.service.listPayments(REQUEST_ID, PROPERTY_ID);
    expect(result.movements).toHaveLength(1);
    expect(result.movements[0]).not.toHaveProperty('gatewayPaymentToken');
    expect(result.movements[0]).not.toHaveProperty('idempotencyKey');
    expect(result.allocations).toHaveLength(1);
    expect(result.resolutions).toHaveLength(1);
    expect(result.resolutions[0]).not.toHaveProperty('idempotencyKey');
    expect(result.resolutions[0]).not.toHaveProperty('operationFingerprint');
    expect(result.resolutions[0]).not.toHaveProperty('providerTransactionId');
    expect(result.resolutions[0]).not.toHaveProperty('providerStatus');
  });

  it('records an exact external payment with processed date/reference and rejects duplicate reference', async () => {
    const harness = makeHarness();
    const input = {
      amount: '75.10',
      currencyCode: 'EUR',
      method: 'bank_transfer' as const,
      processedAt: '2026-08-20T10:00:00.000Z',
      provider: 'bank',
      reference: 'wire-abc',
      notes: 'Deposit received',
    };
    const first = await harness.service.recordExternalPayment(
      REQUEST_ID,
      PROPERTY_ID,
      input,
      actor,
    );
    const second = await harness.service.recordExternalPayment(
      REQUEST_ID,
      PROPERTY_ID,
      input,
      actor,
    );
    expect(first).toMatchObject({
      bookingRequestId: REQUEST_ID,
      folioId: null,
      status: 'captured',
      amount: '75.10',
      processedAt: new Date(input.processedAt),
      gatewayProvider: 'bank',
      reference: 'wire-abc',
    });
    expect(second.id).toBe(first.id);
    expect(harness.state.payments).toHaveLength(1);
    expect(harness.state.consequences).toEqual([
      expect.objectContaining({ kind: expect.stringMatching(/^payment_received:/) }),
    ]);
    expect(harness.state.emails).toHaveLength(1);
    expect(harness.state.emails[0]).toMatchObject({ kind: 'payment' });
    expect(JSON.stringify(harness.state.emails[0])).not.toContain('wire-abc');

    await expect(harness.service.recordExternalPayment(
      REQUEST_ID,
      PROPERTY_ID,
      { ...input, amount: '75.11' },
      actor,
    )).rejects.toThrow(/reference/i);
    for (const changed of [
      { ...input, processedAt: '2026-08-20T11:00:00.000Z' },
      { ...input, method: 'cash' as const },
      { ...input, provider: 'different-bank' },
      { ...input, notes: 'Different note' },
    ]) {
      await expect(harness.service.recordExternalPayment(
        REQUEST_ID,
        PROPERTY_ID,
        changed,
        actor,
      )).rejects.toThrow(/reference|different financial data/i);
    }
    expect(harness.state.payments).toHaveLength(1);
  });

  it('rejects external money for zero-total requests and unsupported scale-three currencies', async () => {
    const zeroTotal = makeHarness({
      requests: [request({ submittedQuoteSnapshot: { grandTotal: '0.00' } })],
    });
    await expect(zeroTotal.service.recordExternalPayment(
      REQUEST_ID,
      PROPERTY_ID,
      {
        amount: '10.00',
        currencyCode: 'EUR',
        method: 'cash',
        processedAt: '2026-08-20T10:00:00.000Z',
        reference: 'zero-total-payment',
      },
      actor,
    )).rejects.toThrow(/zero-total|positive total/i);

    const bhd = makeHarness({
      requests: [request({
        currencyCode: 'BHD',
        submittedQuoteSnapshot: { grandTotal: '100.000' },
      })],
    });
    await expect(bhd.service.recordExternalPayment(
      REQUEST_ID,
      PROPERTY_ID,
      {
        amount: '1.00',
        currencyCode: 'BHD',
        method: 'cash',
        processedAt: '2026-08-20T10:00:00.000Z',
        reference: 'unsupported-bhd',
      },
      actor,
    )).rejects.toThrow(/ledger.*precision|unsupported.*BHD/i);
    expect(bhd.state.payments).toHaveLength(0);
  });

  it('records external money after acceptance directly on the linked folio', async () => {
    const harness = makeHarness({
      requests: [request({
        status: 'accepted',
        acceptedTotal: '220.00',
        acceptedFolioId: FOLIO_ID,
      })],
    });
    const movement = await harness.service.recordExternalPayment(
      REQUEST_ID,
      PROPERTY_ID,
      {
        amount: '20.00',
        currencyCode: 'EUR',
        method: 'cash',
        processedAt: '2026-08-20T10:00:00.000Z',
        reference: 'cash-receipt-1',
      },
      actor,
    );
    expect(movement).toMatchObject({ bookingRequestId: REQUEST_ID, folioId: FOLIO_ID });
    expect(harness.folioService.recalculateBalance).toHaveBeenCalledWith(
      FOLIO_ID,
      PROPERTY_ID,
      expect.anything(),
    );
  });

  it('repairs a missed folio recalculation when an external-payment replay follows acceptance', async () => {
    const harness = makeHarness();
    const input = {
      amount: '20.00',
      currencyCode: 'EUR',
      method: 'cash' as const,
      processedAt: '2026-08-20T10:00:00.000Z',
      reference: 'recalc-replay',
    };
    await harness.service.recordExternalPayment(
      REQUEST_ID,
      PROPERTY_ID,
      input,
      actor,
    );
    Object.assign(harness.state.requests[0], {
      status: 'accepted',
      acceptedTotal: '220.00',
      acceptedFolioId: FOLIO_ID,
    });
    harness.state.payments[0]!.folioId = FOLIO_ID;

    await harness.service.recordExternalPayment(
      REQUEST_ID,
      PROPERTY_ID,
      input,
      actor,
    );
    expect(harness.folioService.recalculateBalance).toHaveBeenCalledWith(
      FOLIO_ID,
      PROPERTY_ID,
      expect.anything(),
    );
  });

  it('reuses canonical partial-refund semantics and persists a refund resolution', async () => {
    const original = capturedPayment({
      method: 'credit_card',
      idempotencyKey: 'booking-request-charge:original',
      gatewayProvider: 'stripe',
      gatewayTransactionId: 'pi_original',
    });
    const harness = makeHarness({ payments: [original] });

    const result = await harness.service.refund(
      REQUEST_ID,
      PAYMENT_ID,
      PROPERTY_ID,
      { amount: '35.00', idempotencyKey: 'partial-refund-1' },
      actor,
    );
    expect(harness.refundGateway.refund).toHaveBeenCalledWith(
      'pi_original',
      35,
      expect.objectContaining({
        idempotencyKey: expect.stringContaining('booking-request-refund:'),
        currencyCode: 'EUR',
      }),
    );
    expect(result.movement).toMatchObject({
      originalPaymentId: PAYMENT_ID,
      amount: '-35.00',
    });
    expect(result.resolution).toMatchObject({
      paymentId: PAYMENT_ID,
      type: 'refund',
      amount: '35.00',
    });
    expect(harness.state.consequences).toEqual([
      expect.objectContaining({ kind: expect.stringMatching(/^payment_refunded:/) }),
    ]);
    expect(harness.state.emails).toEqual([
      expect.objectContaining({ kind: 'refund', logicalKey: expect.stringMatching(/^refund:/) }),
    ]);
  });

  it('persists a refund capacity claim before gateway I/O and recovers an unknown result', async () => {
    const original = capturedPayment({
      method: 'credit_card',
      idempotencyKey: 'booking-request-charge:original',
      gatewayProvider: 'stripe',
      gatewayTransactionId: 'pi_original',
    });
    const harness = makeHarness({ payments: [original] });
    harness.refundGateway.refund
      .mockRejectedValueOnce(new Error('timeout after refund submission'))
      .mockResolvedValueOnce({ success: true, transactionId: 're_recovered' });

    await expect(harness.service.refund(
      REQUEST_ID,
      PAYMENT_ID,
      PROPERTY_ID,
      { amount: '50.00', idempotencyKey: 'refund-timeout' },
      actor,
    )).rejects.toThrow(/unknown|retry/i);
    expect(harness.state.resolutions).toEqual([
      expect.objectContaining({
        paymentId: PAYMENT_ID,
        type: 'refund',
        amount: '50.00',
        status: 'pending',
      }),
    ]);
    expect(harness.state.payments).toHaveLength(1);

    const recovered = await harness.service.refund(
      REQUEST_ID,
      PAYMENT_ID,
      PROPERTY_ID,
      { amount: '50.00', idempotencyKey: 'refund-timeout' },
      actor,
    );
    expect(recovered).toMatchObject({
      movement: { amount: '-50.00', originalPaymentId: PAYMENT_ID },
      resolution: { status: 'completed', amount: '50.00' },
    });
    const keys = harness.refundGateway.refund.mock.calls.map((call) => call[2].idempotencyKey);
    expect(keys).toHaveLength(2);
    expect(new Set(keys).size).toBe(1);
  });

  it.each(['pending', 'requires_action', 'unknown'] as const)(
    'keeps a provider %s refund durable and retryable with exact correlation',
    async (providerStatus) => {
      const harness = makeHarness({
        payments: [capturedPayment({
          method: 'credit_card',
          idempotencyKey: 'booking-request-charge:original',
          gatewayProvider: 'stripe',
          gatewayTransactionId: 'pi_original',
        })],
      });
      harness.refundGateway.refund.mockResolvedValueOnce({
        success: false,
        transactionId: `re_${providerStatus}`,
        providerStatus,
      });

      await expect(harness.service.refund(
        REQUEST_ID,
        PAYMENT_ID,
        PROPERTY_ID,
        { amount: '25.00', idempotencyKey: `refund-${providerStatus}` },
        actor,
      )).rejects.toThrow(/pending|retry|unknown/i);
      expect(harness.state.resolutions[0]).toMatchObject({
        status: 'pending',
        providerTransactionId: `re_${providerStatus}`,
        providerStatus,
      });
      expect(harness.refundGateway.refund).toHaveBeenCalledWith(
        'pi_original',
        25,
        expect.objectContaining({
          metadata: expect.objectContaining({
            claimId: harness.state.resolutions[0]!.id,
            propertyId: PROPERTY_ID,
            bookingRequestId: REQUEST_ID,
            paymentId: PAYMENT_ID,
          }),
        }),
      );
    },
  );

  it('replays a provider-pending refund with the same claim and provider identity', async () => {
    const harness = makeHarness({
      payments: [capturedPayment({
        method: 'credit_card',
        idempotencyKey: 'booking-request-charge:original',
        gatewayProvider: 'stripe',
        gatewayTransactionId: 'pi_original',
      })],
    });
    harness.refundGateway.refund
      .mockResolvedValueOnce({
        success: false,
        transactionId: 're_processing',
        providerStatus: 'pending',
      })
      .mockResolvedValueOnce({
        success: true,
        transactionId: 're_processing',
        providerStatus: 'succeeded',
      });
    const input = { amount: '25.00', idempotencyKey: 'provider-pending-replay' };

    await expect(harness.service.refund(
      REQUEST_ID, PAYMENT_ID, PROPERTY_ID, input, actor,
    )).rejects.toThrow(/pending|retry/i);
    const claimId = harness.state.resolutions[0]!.id;
    const recovered = await harness.service.refund(
      REQUEST_ID, PAYMENT_ID, PROPERTY_ID, input, actor,
    );

    expect(recovered.resolution).toMatchObject({
      id: claimId,
      status: 'completed',
    });
    expect(recovered.resolution).not.toHaveProperty('providerTransactionId');
    expect(harness.state.resolutions[0]!.providerTransactionId).toBe('re_processing');
    const options = harness.refundGateway.refund.mock.calls.map((call) => call[2]);
    expect(new Set(options.map((option) => option.idempotencyKey)).size).toBe(1);
    expect(options.every((option) => option.metadata.claimId === claimId)).toBe(true);
  });

  it.each(['failed', 'canceled'] as const)(
    'fails a provider %s refund claim and releases its reserved capacity',
    async (providerStatus) => {
      const harness = makeHarness({
        payments: [capturedPayment({
          method: 'credit_card',
          idempotencyKey: 'booking-request-charge:original',
          gatewayProvider: 'stripe',
          gatewayTransactionId: 'pi_original',
        })],
      });
      harness.refundGateway.refund.mockResolvedValueOnce({
        success: false,
        transactionId: `re_${providerStatus}`,
        providerStatus,
        errorMessage: `Refund ${providerStatus}`,
      });

      await expect(harness.service.refund(
        REQUEST_ID,
        PAYMENT_ID,
        PROPERTY_ID,
        { amount: '25.00', idempotencyKey: `refund-${providerStatus}` },
        actor,
      )).rejects.toThrow(providerStatus);
      expect(harness.state.resolutions[0]).toMatchObject({
        status: 'failed',
        providerTransactionId: `re_${providerStatus}`,
        providerStatus,
      });
    },
  );

  it('reserves refund capacity across different keys and competing retention', async () => {
    const original = capturedPayment({
      method: 'credit_card',
      idempotencyKey: 'booking-request-charge:original',
      gatewayProvider: 'stripe',
      gatewayTransactionId: 'pi_original',
    });
    const harness = makeHarness({
      payments: [original],
      resolutions: [{
        id: '99999999-0000-4000-a000-000000000001',
        propertyId: PROPERTY_ID,
        bookingRequestId: REQUEST_ID,
        paymentId: PAYMENT_ID,
        type: 'refund',
        amount: '50.00',
        status: 'pending',
        idempotencyKey: 'booking-request-refund:pending',
        operationFingerprint: 'pending-fingerprint',
        reason: 'Gateway refund pending',
      }],
    });

    await expect(harness.service.refund(
      REQUEST_ID,
      PAYMENT_ID,
      PROPERTY_ID,
      { amount: '50.01', idempotencyKey: 'second-refund' },
      actor,
    )).rejects.toThrow(/remaining/i);
    await expect(harness.service.retainForDenial(
      REQUEST_ID,
      PAYMENT_ID,
      PROPERTY_ID,
      { amount: '50.01', reason: 'Competing retained amount' },
      actor,
    )).rejects.toThrow(/remaining/i);
    expect(harness.refundGateway.refund).not.toHaveBeenCalled();
  });

  it('allows two distinct fifty-unit claims to exactly exhaust a one-hundred payment', async () => {
    const harness = makeHarness({
      payments: [capturedPayment({
        method: 'credit_card',
        amount: '100.00',
        idempotencyKey: 'booking-request-charge:original',
        gatewayProvider: 'stripe',
        gatewayTransactionId: 'pi_original',
      })],
    });

    await harness.service.refund(
      REQUEST_ID,
      PAYMENT_ID,
      PROPERTY_ID,
      { amount: '50.00', idempotencyKey: 'refund-half-one' },
      actor,
    );
    await harness.service.refund(
      REQUEST_ID,
      PAYMENT_ID,
      PROPERTY_ID,
      { amount: '50.00', idempotencyKey: 'refund-half-two' },
      actor,
    );

    expect(harness.state.resolutions.filter((row) => row.status === 'completed')).toHaveLength(2);
    expect(harness.state.payments.filter((row) => row.originalPaymentId === PAYMENT_ID))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ amount: '-50.00' }),
        expect.objectContaining({ amount: '-50.00' }),
      ]));
  });

  it('uses the freshly locked folio when acceptance completes during refund I/O', async () => {
    const harness = makeHarness({
      payments: [capturedPayment({
        method: 'credit_card',
        idempotencyKey: 'booking-request-charge:original',
        gatewayProvider: 'stripe',
        gatewayTransactionId: 'pi_original',
      })],
    });
    let release!: (value: { success: true; transactionId: string }) => void;
    harness.refundGateway.refund.mockImplementation(() => new Promise((resolve) => {
      release = resolve;
    }));

    const refunding = harness.service.refund(
      REQUEST_ID,
      PAYMENT_ID,
      PROPERTY_ID,
      { amount: '25.00', idempotencyKey: 'accept-during-refund' },
      actor,
    );
    await vi.waitFor(() => expect(harness.refundGateway.refund).toHaveBeenCalledTimes(1));
    Object.assign(harness.state.requests[0], {
      status: 'accepted',
      acceptedTotal: '220.00',
      acceptedFolioId: FOLIO_ID,
    });
    harness.state.payments[0]!.folioId = FOLIO_ID;
    release({ success: true, transactionId: 're_after_accept' });

    const result = await refunding;
    expect(result.movement).toMatchObject({ folioId: FOLIO_ID, amount: '-25.00' });
    expect(harness.folioService.recalculateBalance).toHaveBeenCalledWith(
      FOLIO_ID,
      PROPERTY_ID,
      expect.anything(),
    );
  });

  it('heals allocations when a concurrent webhook completes the refund during provider I/O', async () => {
    const movementId = 'dddddddd-0000-4000-a000-000000000077';
    const harness = makeHarness({
      installments: [installment({ allocatedAmount: '100.00', status: 'paid' })],
      allocations: [{
        id: '88888888-0000-4000-a000-000000000077',
        propertyId: PROPERTY_ID,
        bookingRequestId: REQUEST_ID,
        paymentId: PAYMENT_ID,
        installmentId: INSTALLMENT_ID,
        amount: '100.00',
        createdAt: new Date('2026-08-20T10:00:00.000Z'),
      }],
      payments: [capturedPayment({
        amount: '100.00',
        method: 'credit_card',
        idempotencyKey: 'booking-request-charge:original',
        gatewayProvider: 'stripe',
        gatewayTransactionId: 'pi_original',
      })],
    });
    let release!: (value: { success: true; transactionId: string }) => void;
    harness.refundGateway.refund.mockImplementation(() => new Promise((resolve) => {
      release = resolve;
    }));

    const refunding = harness.service.refund(
      REQUEST_ID,
      PAYMENT_ID,
      PROPERTY_ID,
      { amount: '40.00', idempotencyKey: 'webhook-wins-refund-race' },
      actor,
    );
    await vi.waitFor(() => expect(harness.refundGateway.refund).toHaveBeenCalledTimes(1));
    harness.state.payments.push(capturedPayment({
      id: movementId,
      amount: '-40.00',
      originalPaymentId: PAYMENT_ID,
      idempotencyKey: 'booking-request-refund:webhook-wins-refund-race',
      gatewayTransactionId: 're_webhook_won',
    }));
    Object.assign(harness.state.resolutions[0]!, {
      status: 'completed',
      movementId,
      providerTransactionId: 're_webhook_won',
      providerStatus: 'succeeded',
      resolvedAt: new Date(),
    });
    release({ success: true, transactionId: 're_webhook_won' });

    await expect(refunding).resolves.toMatchObject({
      movement: { id: movementId },
      resolution: { status: 'completed' },
    });
    expect(harness.state.allocations).toEqual([
      expect.objectContaining({ amount: '60.00' }),
    ]);
    expect(harness.state.installments[0]).toMatchObject({
      allocatedAmount: '60.00', status: 'partial',
    });
  });

  it('keeps a captured provider refund claim retryable when folio recalculation rolls back', async () => {
    const harness = makeHarness({
      requests: [request({
        status: 'accepted',
        acceptedTotal: '220.00',
        acceptedFolioId: FOLIO_ID,
      })],
      payments: [capturedPayment({
        folioId: FOLIO_ID,
        method: 'credit_card',
        idempotencyKey: 'booking-request-charge:original',
        gatewayProvider: 'stripe',
        gatewayTransactionId: 'pi_original',
      })],
    });
    harness.folioService.recalculateBalance
      .mockRejectedValueOnce(new Error('folio lock timeout'))
      .mockResolvedValueOnce(undefined);

    await expect(harness.service.refund(
      REQUEST_ID,
      PAYMENT_ID,
      PROPERTY_ID,
      { amount: '25.00', idempotencyKey: 'refund-recalc-recovery' },
      actor,
    )).rejects.toThrow(/folio lock timeout/i);
    expect(harness.state.resolutions).toEqual([
      expect.objectContaining({ status: 'pending', amount: '25.00' }),
    ]);
    expect(harness.state.payments).toHaveLength(1);

    const recovered = await harness.service.refund(
      REQUEST_ID,
      PAYMENT_ID,
      PROPERTY_ID,
      { amount: '25.00', idempotencyKey: 'refund-recalc-recovery' },
      actor,
    );
    expect(recovered.resolution).toMatchObject({ status: 'completed' });
    const keys = harness.refundGateway.refund.mock.calls.map((call) => call[2].idempotencyKey);
    expect(new Set(keys).size).toBe(1);
  });

  it('replays a fully completed refund before remaining-capacity validation', async () => {
    const original = capturedPayment({
      method: 'credit_card',
      idempotencyKey: 'booking-request-charge:original',
      gatewayProvider: 'stripe',
      gatewayTransactionId: 'pi_original',
    });
    const harness = makeHarness({ payments: [original] });

    const first = await harness.service.refund(
      REQUEST_ID,
      PAYMENT_ID,
      PROPERTY_ID,
      { amount: '100.00', idempotencyKey: 'full-refund' },
      actor,
    );
    const replay = await harness.service.refund(
      REQUEST_ID,
      PAYMENT_ID,
      PROPERTY_ID,
      { amount: '100.00', idempotencyKey: 'full-refund' },
      actor,
    );
    expect(replay.movement.id).toBe(first.movement.id);
    expect(harness.refundGateway.refund).toHaveBeenCalledTimes(1);
    await expect(harness.service.refund(
      REQUEST_ID,
      PAYMENT_ID,
      PROPERTY_ID,
      { amount: '99.00', idempotencyKey: 'full-refund' },
      actor,
    )).rejects.toThrow(/different/i);
  });

  it('heals stale paid allocations when a completed refund is replayed', async () => {
    const harness = makeHarness({
      installments: [installment({
        resolvedAmount: '100.00', allocatedAmount: '0.00', status: 'unpaid',
      })],
      payments: [capturedPayment({
        amount: '100.00',
        method: 'credit_card',
        idempotencyKey: 'booking-request-charge:original',
        gatewayProvider: 'stripe',
        gatewayTransactionId: 'pi_original',
      })],
    });
    const input = { amount: '40.00', idempotencyKey: 'refund-heals-stale-allocation' };
    await harness.service.refund(REQUEST_ID, PAYMENT_ID, PROPERTY_ID, input, actor);
    Object.assign(harness.state.installments[0]!, {
      allocatedAmount: '100.00', status: 'paid',
    });
    harness.state.allocations.push({
      id: '88888888-0000-4000-a000-000000000001',
      propertyId: PROPERTY_ID,
      bookingRequestId: REQUEST_ID,
      paymentId: PAYMENT_ID,
      installmentId: INSTALLMENT_ID,
      amount: '100.00',
      createdAt: new Date('2026-08-20T10:00:00.000Z'),
    });

    await harness.service.refund(REQUEST_ID, PAYMENT_ID, PROPERTY_ID, input, actor);

    expect(harness.state.allocations).toEqual([
      expect.objectContaining({ amount: '60.00' }),
    ]);
    expect(harness.state.installments).toEqual([
      expect.objectContaining({ allocatedAmount: '60.00', status: 'partial' }),
    ]);
    expect(harness.refundGateway.refund).toHaveBeenCalledTimes(1);
  });

  it('does not send an externally recorded payment to the configured gateway refund adapter', async () => {
    const harness = makeHarness({
      payments: [capturedPayment({ method: 'credit_card', gatewayProvider: 'square' })],
    });
    await expect(harness.service.refund(
      REQUEST_ID,
      PAYMENT_ID,
      PROPERTY_ID,
      { amount: '10.00', idempotencyKey: 'wrong-refund-path' },
      actor,
    )).rejects.toThrow(/external return/i);
    expect(harness.refundGateway.refund).not.toHaveBeenCalled();
  });

  it('records partial external returns as negative canonical movements', async () => {
    const harness = makeHarness({ payments: [capturedPayment()] });
    const result = await harness.service.recordExternalReturn(
      REQUEST_ID,
      PAYMENT_ID,
      PROPERTY_ID,
      {
        amount: '30.00',
        processedAt: '2026-08-21T10:00:00.000Z',
        reference: 'return-1',
        notes: 'Returned by bank transfer',
      },
      actor,
    );
    expect(result.movement).toMatchObject({
      propertyId: PROPERTY_ID,
      bookingRequestId: REQUEST_ID,
      originalPaymentId: PAYMENT_ID,
      amount: '-30.00',
      status: 'captured',
      reference: 'return-1',
    });
    expect(result.resolution).toMatchObject({
      paymentId: PAYMENT_ID,
      type: 'external_return',
      amount: '30.00',
      movementId: result.movement.id,
    });
    expect(harness.state.consequences).toEqual([
      expect.objectContaining({
        kind: expect.stringMatching(/^payment_refunded:/),
        payload: expect.objectContaining({
          event: 'payment.refunded',
          data: expect.objectContaining({ source: 'external_return', method: 'cash' }),
        }),
      }),
    ]);
    const event = harness.state.consequences[0]?.['payload']?.['event'] as WebhookEvent;
    expect(WEBHOOK_EVENTS[event]).toBe(event);
    expect(harness.state.emails).toEqual([
      expect.objectContaining({ kind: 'refund', logicalKey: expect.stringMatching(/^refund:/) }),
    ]);
    expect(JSON.stringify(harness.state.emails[0])).not.toContain('return-1');
  });

  it('fingerprints the complete external-return record for exact replay', async () => {
    const harness = makeHarness({ payments: [capturedPayment()] });
    const input = {
      amount: '30.00',
      processedAt: '2026-08-21T10:00:00.000Z',
      reference: 'return-fingerprint',
      notes: 'Returned at bank',
    };
    const first = await harness.service.recordExternalReturn(
      REQUEST_ID,
      PAYMENT_ID,
      PROPERTY_ID,
      input,
      actor,
    );
    const replay = await harness.service.recordExternalReturn(
      REQUEST_ID,
      PAYMENT_ID,
      PROPERTY_ID,
      input,
      actor,
    );
    expect(replay.movement.id).toBe(first.movement.id);

    for (const changed of [
      { ...input, processedAt: '2026-08-21T11:00:00.000Z' },
      { ...input, notes: 'Different note' },
    ]) {
      await expect(harness.service.recordExternalReturn(
        REQUEST_ID,
        PAYMENT_ID,
        PROPERTY_ID,
        changed,
        actor,
      )).rejects.toThrow(/reference|different financial data/i);
    }
  });

  it('repairs a missed folio recalculation on an exact external-return replay', async () => {
    const harness = makeHarness({ payments: [capturedPayment()] });
    const input = {
      amount: '30.00',
      processedAt: '2026-08-21T10:00:00.000Z',
      reference: 'return-recalc-replay',
    };
    await harness.service.recordExternalReturn(
      REQUEST_ID,
      PAYMENT_ID,
      PROPERTY_ID,
      input,
      actor,
    );
    Object.assign(harness.state.requests[0], {
      status: 'accepted',
      acceptedTotal: '220.00',
      acceptedFolioId: FOLIO_ID,
    });
    for (const payment of harness.state.payments) payment.folioId = FOLIO_ID;

    await harness.service.recordExternalReturn(
      REQUEST_ID,
      PAYMENT_ID,
      PROPERTY_ID,
      input,
      actor,
    );
    expect(harness.folioService.recalculateBalance).toHaveBeenCalledWith(
      FOLIO_ID,
      PROPERTY_ID,
      expect.anything(),
    );
  });

  it('heals stale paid allocations when a completed external return is replayed', async () => {
    const harness = makeHarness({
      installments: [installment({
        resolvedAmount: '100.00', allocatedAmount: '0.00', status: 'unpaid',
      })],
      payments: [capturedPayment({ amount: '100.00' })],
    });
    const input = {
      amount: '40.00',
      processedAt: '2026-08-21T10:00:00.000Z',
      reference: 'return-heals-stale-allocation',
    };
    await harness.service.recordExternalReturn(
      REQUEST_ID, PAYMENT_ID, PROPERTY_ID, input, actor,
    );
    Object.assign(harness.state.installments[0]!, {
      allocatedAmount: '100.00', status: 'paid',
    });
    harness.state.allocations.push({
      id: '88888888-0000-4000-a000-000000000001',
      propertyId: PROPERTY_ID,
      bookingRequestId: REQUEST_ID,
      paymentId: PAYMENT_ID,
      installmentId: INSTALLMENT_ID,
      amount: '100.00',
      createdAt: new Date('2026-08-20T10:00:00.000Z'),
    });

    await harness.service.recordExternalReturn(
      REQUEST_ID, PAYMENT_ID, PROPERTY_ID, input, actor,
    );

    expect(harness.state.allocations).toEqual([
      expect.objectContaining({ amount: '60.00' }),
    ]);
    expect(harness.state.installments).toEqual([
      expect.objectContaining({ allocatedAmount: '60.00', status: 'partial' }),
    ]);
  });

  it('releases over-allocated value and recomputes installment state after a return', async () => {
    const harness = makeHarness({
      installments: [installment({
        resolvedAmount: '100.00',
        allocatedAmount: '80.00',
        status: 'partial',
      })],
      payments: [capturedPayment({ amount: '100.00' })],
      allocations: [{
        id: '88888888-0000-4000-a000-000000000001',
        propertyId: PROPERTY_ID,
        bookingRequestId: REQUEST_ID,
        paymentId: PAYMENT_ID,
        installmentId: INSTALLMENT_ID,
        amount: '80.00',
        createdAt: new Date('2026-08-20T10:00:00.000Z'),
      }],
    });

    await harness.service.recordExternalReturn(
      REQUEST_ID,
      PAYMENT_ID,
      PROPERTY_ID,
      {
        amount: '40.00',
        processedAt: '2026-08-21T10:00:00.000Z',
        reference: 'return-releases-allocation',
      },
      actor,
    );

    expect(harness.state.allocations).toEqual([
      expect.objectContaining({ amount: '60.00' }),
    ]);
    expect(harness.state.installments).toEqual([
      expect.objectContaining({ allocatedAmount: '60.00', status: 'partial' }),
    ]);
  });

  it('requires a reason for retained money and supports partial retained resolution', async () => {
    const harness = makeHarness({ payments: [capturedPayment()] });
    await expect(harness.service.retainForDenial(
      REQUEST_ID,
      PAYMENT_ID,
      PROPERTY_ID,
      { amount: '20.00', reason: '  ' },
      actor,
    )).rejects.toThrow(/reason/i);

    const retained = await harness.service.retainForDenial(
      REQUEST_ID,
      PAYMENT_ID,
      PROPERTY_ID,
      { amount: '20.00', reason: 'Non-refundable supplier cost' },
      actor,
    );
    expect(retained).toMatchObject({
      paymentId: PAYMENT_ID,
      type: 'retained',
      amount: '20.00',
      reason: 'Non-refundable supplier cost',
      resolvedBy: actor.userId,
    });
    expect(harness.state.consequences).toHaveLength(0);
    expect(harness.state.emails).toHaveLength(0);
  });

  it('allows retention only while the request decision is pending', async () => {
    for (const status of ['accepted', 'denied'] as const) {
      const harness = makeHarness({
        requests: [request({
          status,
          acceptedTotal: status === 'accepted' ? '220.00' : null,
          acceptedFolioId: status === 'accepted' ? FOLIO_ID : null,
        })],
        payments: [capturedPayment({
          folioId: status === 'accepted' ? FOLIO_ID : null,
        })],
      });
      await expect(harness.service.retainForDenial(
        REQUEST_ID,
        PAYMENT_ID,
        PROPERTY_ID,
        { amount: '20.00', reason: 'Supplier cost' },
        actor,
      )).rejects.toThrow(/pending request/i);
      expect(harness.state.resolutions).toHaveLength(0);
    }
  });

  it('rejects zero/negative, future-dated, wrong-currency, over-resolved, and cross-property movements', async () => {
    const harness = makeHarness({
      payments: [capturedPayment()],
      resolutions: [{
        id: '00000000-0000-4000-a000-000000000001',
        propertyId: PROPERTY_ID,
        bookingRequestId: REQUEST_ID,
        paymentId: PAYMENT_ID,
        type: 'retained',
        amount: '90.00',
        reason: 'Existing resolution',
      }],
    });
    await expect(harness.service.recordExternalPayment(REQUEST_ID, PROPERTY_ID, {
      amount: '10.00',
      currencyCode: 'USD',
      method: 'cash',
      processedAt: '2026-08-20T10:00:00.000Z',
      reference: 'wrong-currency',
    }, actor)).rejects.toThrow(/currency/i);
    await expect(harness.service.recordExternalPayment(REQUEST_ID, PROPERTY_ID, {
      amount: '10.00',
      currencyCode: 'EUR',
      method: 'cash',
      processedAt: new Date(Date.now() + 86_400_000).toISOString(),
      reference: 'future',
    }, actor)).rejects.toThrow(/future/i);
    await expect(harness.service.retainForDenial(
      REQUEST_ID,
      PAYMENT_ID,
      PROPERTY_ID,
      { amount: '20.00', reason: 'Too much' },
      actor,
    )).rejects.toThrow(/remaining/i);

    const crossProperty = makeHarness({
      requests: [request({ propertyId: OTHER_PROPERTY_ID })],
      payments: [capturedPayment({ propertyId: OTHER_PROPERTY_ID })],
    });
    await expect(crossProperty.service.recordExternalReturn(
      REQUEST_ID,
      PAYMENT_ID,
      PROPERTY_ID,
      {
        amount: '10.00',
        processedAt: '2026-08-20T10:00:00.000Z',
        reference: 'cross-property',
      },
      actor,
    )).rejects.toBeInstanceOf(NotFoundException);
  });

  it('audits durable installment, payment, allocation, return, and retention consequences', async () => {
    const harness = makeHarness({
      installments: [installment()],
      payments: [capturedPayment()],
    });
    await harness.service.allocatePayment(
      REQUEST_ID,
      INSTALLMENT_ID,
      PROPERTY_ID,
      { paymentId: PAYMENT_ID, amount: '10.00' },
      actor,
    );
    await harness.service.retainForDenial(
      REQUEST_ID,
      PAYMENT_ID,
      PROPERTY_ID,
      { amount: '10.00', reason: 'Supplier fee' },
      actor,
    );
    expect(harness.state.audits).toEqual(expect.arrayContaining([
      expect.objectContaining({
        entityType: 'booking_request_payment_allocation',
        userId: actor.userId,
      }),
      expect.objectContaining({
        entityType: 'booking_request_payment_resolution',
        userId: actor.userId,
      }),
    ]));
  });
});
