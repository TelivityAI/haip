import { ConflictException, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  auditLogs,
  bookingRequestInstallments,
  bookingRequestPaymentAllocations,
  bookingRequestPaymentResolutions,
  bookingRequests,
  payments,
} from '@telivityhaip/database';
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
  const canonicalPaymentService = {
    refundPayment: vi.fn(),
  };
  const folioService = {
    recalculateBalance: vi.fn(),
  };
  const service = new (BookingRequestPaymentService as any)(
    database.db,
    gateway,
    canonicalPaymentService,
    folioService,
  ) as BookingRequestPaymentService;
  return {
    service,
    state,
    database,
    gateway,
    canonicalPaymentService,
    folioService,
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
      gatewayTransactionId: 'pi_saved_1',
    });
    expect(result).not.toHaveProperty('gatewayPaymentToken');
    expect(result).not.toHaveProperty('idempotencyKey');
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
      expect(result.gatewayTransactionId).toBe(gatewayResult.transactionId);
      expect(JSON.stringify(result)).not.toMatch(/client_secret|authentication_url|https?:\/\//i);
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
        amount: '10.00',
        reason: 'Supplier fee',
      }],
    });

    const result = await harness.service.listPayments(REQUEST_ID, PROPERTY_ID);
    expect(result.movements).toHaveLength(1);
    expect(result.movements[0]).not.toHaveProperty('gatewayPaymentToken');
    expect(result.movements[0]).not.toHaveProperty('idempotencyKey');
    expect(result.allocations).toHaveLength(1);
    expect(result.resolutions).toHaveLength(1);
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
      gatewayTransactionId: 'wire-abc',
    });
    expect(second.id).toBe(first.id);
    expect(harness.state.payments).toHaveLength(1);

    await expect(harness.service.recordExternalPayment(
      REQUEST_ID,
      PROPERTY_ID,
      { ...input, amount: '75.11' },
      actor,
    )).rejects.toThrow(/reference/i);
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
    );
  });

  it('reuses canonical partial-refund semantics and persists a refund resolution', async () => {
    const original = capturedPayment({
      method: 'credit_card',
      idempotencyKey: 'booking-request-charge:original',
      gatewayProvider: 'stripe',
      gatewayTransactionId: 'pi_original',
    });
    const refund = {
      ...capturedPayment(),
      id: 'dddddddd-0000-4000-a000-000000000002',
      amount: '-35.00',
      originalPaymentId: PAYMENT_ID,
      idempotencyKey: 'booking-request-refund:partial-1',
    };
    const harness = makeHarness({ payments: [original] });
    harness.canonicalPaymentService.refundPayment.mockResolvedValueOnce(refund);

    const result = await harness.service.refund(
      REQUEST_ID,
      PAYMENT_ID,
      PROPERTY_ID,
      { amount: '35.00', idempotencyKey: 'partial-refund-1' },
      actor,
    );
    expect(harness.canonicalPaymentService.refundPayment).toHaveBeenCalledWith(
      PAYMENT_ID,
      PROPERTY_ID,
      '35.00',
      { idempotencyKey: expect.stringContaining('booking-request-refund:') },
    );
    expect(result.movement).toMatchObject({
      id: refund.id,
      originalPaymentId: PAYMENT_ID,
      amount: '-35.00',
    });
    expect(result.resolution).toMatchObject({
      paymentId: PAYMENT_ID,
      type: 'refund',
      amount: '35.00',
    });
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
    expect(harness.canonicalPaymentService.refundPayment).not.toHaveBeenCalled();
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
      gatewayTransactionId: 'return-1',
    });
    expect(result.resolution).toMatchObject({
      paymentId: PAYMENT_ID,
      type: 'external_return',
      amount: '30.00',
    });
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
