import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
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
  bookings,
  folios,
  guests,
  payments,
  ratePlanComponents,
  reservationGuests,
  reservationServices,
  reservations,
  roomTypes,
  services,
} from '@telivityhaip/database';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PERMISSIONS_KEY } from '../auth/permissions.decorator';
import { AncillaryService } from '../ancillary/ancillary.service';
import { FolioService } from '../folio/folio.service';
import { GuestService } from '../guest/guest.service';
import { ReservationService } from '../reservation/reservation.service';
import {
  acceptancePreviewFingerprint,
  BookingRequestService,
} from './booking-request.service';

const PROPERTY_ID = 'aaaaaaaa-0000-4000-a000-000000000001';
const OTHER_PROPERTY_ID = 'aaaaaaaa-0000-4000-a000-000000000002';
const REQUEST_ID = 'bbbbbbbb-0000-4000-a000-000000000001';
const ROOM_TYPE_ID = 'cccccccc-0000-4000-a000-000000000001';
const RATE_PLAN_ID = 'dddddddd-0000-4000-a000-000000000001';
const RESERVATION_ID = 'eeeeeeee-0000-4000-a000-000000000001';
const FOLIO_ID = 'ffffffff-0000-4000-a000-000000000001';
const GUEST_ID = '11111111-0000-4000-a000-000000000001';
const PAYMENT_ID = '22222222-0000-4000-a000-000000000001';

const submittedQuote = {
  propertyId: PROPERTY_ID,
  roomTypeId: ROOM_TYPE_ID,
  ratePlanId: RATE_PLAN_ID,
  checkIn: '2026-10-01',
  checkOut: '2026-10-03',
  nights: 2,
  currencyCode: 'EUR',
  lineItems: [
    { date: '2026-10-01', rate: '100.00', tax: '10.00' },
    { date: '2026-10-02', rate: '100.00', tax: '10.00' },
  ],
  roomTotal: '200.00',
  taxTotal: '20.00',
  services: [],
  servicesTotal: '0.00',
  servicesTaxTotal: '0.00',
  grandTotal: '220.00',
  depositPolicy: { type: 'none', refundable: true },
  depositDue: '0.00',
  cancellationPolicy: {
    type: 'flexible',
    description: 'Free cancellation before arrival.',
    freeCancelHoursBeforeArrival: 24,
  },
};

const currentQuote = {
  ...structuredClone(submittedQuote),
  roomTotal: '240.00',
  taxTotal: '20.00',
  grandTotal: '260.00',
  lineItems: [
    { date: '2026-10-01', rate: '120.00', tax: '10.00' },
    { date: '2026-10-02', rate: '120.00', tax: '10.00' },
  ],
};

type RequestRow = {
  id: string;
  propertyId: string;
  status: 'pending' | 'accepted' | 'denied';
  arrivalDate: string;
  departureDate: string;
  roomTypeId: string;
  ratePlanId: string;
  adults: number;
  children: number;
  guestFirstName: string;
  guestLastName: string;
  guestEmail: string;
  guestPhone: string | null;
  specialRequests: string | null;
  serviceIds: string[];
  submittedQuoteSnapshot: typeof submittedQuote;
  currentQuoteSnapshot: typeof currentQuote | null;
  currencyCode: string;
  acceptedPriceSource: 'submitted' | 'current' | 'custom' | null;
  acceptedTotal: string | null;
  customPriceReason: string | null;
  acceptedReservationId: string | null;
  acceptedFolioId: string | null;
  decidedBy: string | null;
  decidedAt: Date | null;
  denialReason: string | null;
  stripePaymentMethodId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function pendingRequest(overrides: Partial<RequestRow> = {}): RequestRow {
  return {
    id: REQUEST_ID,
    propertyId: PROPERTY_ID,
    status: 'pending',
    arrivalDate: '2026-10-01',
    departureDate: '2026-10-03',
    roomTypeId: ROOM_TYPE_ID,
    ratePlanId: RATE_PLAN_ID,
    adults: 2,
    children: 1,
    guestFirstName: 'Ada',
    guestLastName: 'Lovelace',
    guestEmail: 'ada@example.com',
    guestPhone: '+34 600 000 000',
    specialRequests: 'A quiet room, please.',
    serviceIds: [],
    submittedQuoteSnapshot: structuredClone(submittedQuote),
    currentQuoteSnapshot: null,
    currencyCode: 'EUR',
    acceptedPriceSource: null,
    acceptedTotal: null,
    customPriceReason: null,
    acceptedReservationId: null,
    acceptedFolioId: null,
    decidedBy: null,
    decidedAt: null,
    denialReason: null,
    stripePaymentMethodId: null,
    createdAt: new Date('2026-08-24T10:00:00.000Z'),
    updatedAt: new Date('2026-08-24T10:00:00.000Z'),
    ...overrides,
  };
}

function previewToken(
  quote: { currencyCode: string; grandTotal: string } = currentQuote,
  request: RequestRow = pendingRequest(),
) {
  return acceptancePreviewFingerprint({
    requestId: request.id,
    propertyId: request.propertyId,
    requestUpdatedAt: request.updatedAt,
    currencyCode: quote.currencyCode,
    currentTotal: quote.grandTotal,
  });
}

type State = {
  requests: RequestRow[];
  guests: Array<Record<string, unknown>>;
  reservations: Array<Record<string, unknown>>;
  folios: Array<Record<string, unknown>>;
  payments: Array<Record<string, unknown>>;
  installments: Array<Record<string, unknown>>;
  allocations: Array<Record<string, unknown>>;
  resolutions: Array<Record<string, unknown>>;
  emailDeliveries: Array<Record<string, unknown>>;
  audits: Array<Record<string, unknown>>;
  consequences: Array<Record<string, unknown>>;
};

function cloneState(state: State): State {
  return structuredClone(state);
}

function restoreState(state: State, snapshot: State): void {
  for (const key of Object.keys(snapshot) as Array<keyof State>) {
    state[key].splice(0, state[key].length, ...structuredClone(snapshot[key]));
  }
}

function makeDatabase(state: State) {
  let rowLockQueue = Promise.resolve();
  let transactionActive = false;

  const rowsFor = (table: unknown): Array<Record<string, unknown>> => {
    if (table === bookingRequests) return state.requests;
    if (table === guests) return state.guests;
    if (table === reservations) return state.reservations;
    if (table === folios) return state.folios;
    if (table === payments) return state.payments;
    if (table === bookingRequestInstallments) return state.installments;
    if (table === bookingRequestPaymentAllocations) return state.allocations;
    if (table === bookingRequestPaymentResolutions) return state.resolutions;
    if (table === bookingRequestEmailDeliveries) return state.emailDeliveries;
    if (table === auditLogs) return state.audits;
    if (table === bookingRequestConsequences) return state.consequences;
    return [];
  };

  const createSelect = (
    selection?: Record<string, unknown>,
    acquireLock?: () => Promise<void>,
  ) => {
    let table: unknown;
    let offset = 0;
    let limit: number | undefined;
    const resolveRows = () => {
      let rows = structuredClone(rowsFor(table));
      if (selection && Object.keys(selection).length === 1 && 'count' in selection) {
        return [{ count: rows.length }];
      }
      if (table === auditLogs && selection && 'occurredAtMicros' in selection) {
        rows = rows.map((row) => ({
          ...row,
          occurredAtMicros: row['occurredAtMicros']
            ?? String(BigInt((row['occurredAt'] as Date).getTime()) * 1000n),
        }));
      }
      return rows.slice(offset, limit == null ? undefined : offset + limit);
    };
    const chain: Record<string, unknown> & PromiseLike<unknown> = {
      from: vi.fn((selectedTable: unknown) => {
        table = selectedTable;
        return chain;
      }),
      leftJoin: vi.fn(() => chain),
      innerJoin: vi.fn(() => chain),
      where: vi.fn(() => chain),
      for: vi.fn(async () => {
        await acquireLock?.();
        return resolveRows();
      }),
      orderBy: vi.fn(() => chain),
      limit: vi.fn((value: number) => {
        limit = value;
        return chain;
      }),
      offset: vi.fn((value: number) => {
        offset = value;
        return chain;
      }),
      then: (resolve, reject) => Promise.resolve(resolveRows()).then(resolve, reject),
    };
    return chain;
  };

  const db: Record<string, unknown> = {};
  db['select'] = vi.fn((selection?: Record<string, unknown>) =>
    createSelect(selection));

  db['insert'] = vi.fn((table: unknown) => ({
    values: vi.fn((values: Record<string, unknown>) => {
      const insert = () => {
        const row = {
          id: values['id'] ?? `row-${rowsFor(table).length + 1}`,
          ...structuredClone(values),
        };
        rowsFor(table).push(row);
        return row;
      };
      const direct = Promise.resolve().then(() => insert()).then(() => undefined);
      return Object.assign(direct, {
        returning: vi.fn(async () => [insert()]),
        onConflictDoNothing: vi.fn(() => ({
          returning: vi.fn(async () => [insert()]),
        })),
      });
    }),
  }));

  db['update'] = vi.fn((table: unknown) => ({
    set: vi.fn((changes: Record<string, unknown>) => {
      const apply = () => {
        const rows = rowsFor(table);
        for (const row of rows) Object.assign(row, structuredClone(changes));
        return structuredClone(rows);
      };
      return {
        where: vi.fn(() => {
          const direct = Promise.resolve().then(() => apply()).then(() => undefined);
          return Object.assign(direct, {
            returning: vi.fn(async () => apply()),
          });
        }),
      };
    }),
  }));

  db['delete'] = vi.fn(() => {
    throw new Error('Booking Request decisions must not delete business records');
  });

  db['transaction'] = vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => {
    let release = () => undefined;
    let acquired = false;
    const tx = {
      ...db,
      select: vi.fn((selection?: Record<string, unknown>) => createSelect(
        selection,
        async () => {
          const previous = rowLockQueue;
          rowLockQueue = new Promise<void>((resolve) => {
            release = resolve;
          });
          await previous;
          acquired = true;
        },
      )),
    };
    const snapshot = cloneState(state);
    transactionActive = true;
    try {
      return await callback(tx);
    } catch (error) {
      restoreState(state, snapshot);
      throw error;
    } finally {
      transactionActive = false;
      if (acquired) release();
    }
  });

  return {
    db,
    isTransactionActive: () => transactionActive,
  };
}

function makeHarness(requests: RequestRow[] = [pendingRequest()]) {
  const state: State = {
    requests: structuredClone(requests),
    guests: [],
    reservations: [],
    folios: [],
    payments: [],
    installments: [],
    allocations: [],
    resolutions: [],
    emailDeliveries: [],
    audits: [],
    consequences: [],
  };
  const database = makeDatabase(state);
  let reservationCreates = 0;
  let hasAvailability = true;
  const dispatchTransactionStates: boolean[] = [];
  const quoteTransactionStates: boolean[] = [];

  const config = { getPublicConfig: vi.fn() };
  const bookingEngine = {
    quote: vi.fn(async () => {
      quoteTransactionStates.push(database.isTransactionActive());
      return structuredClone(currentQuote);
    }),
  };
  const availability = { searchAvailability: vi.fn() };
  const ratePlan = { assertSellable: vi.fn() };
  const savedPaymentMethod = {
    createSetup: vi.fn(),
    resolveSetup: vi.fn(),
    charge: vi.fn(() => {
      throw new Error('Acceptance must never charge a payment method');
    }),
  };
  const webhook = {
    dispatchPersisted: vi.fn(async () => {
      dispatchTransactionStates.push(database.isTransactionActive());
    }),
    emit: vi.fn(async () => {
      dispatchTransactionStates.push(database.isTransactionActive());
    }),
  };
  const guest = {
    create: vi.fn(async (dto: Record<string, unknown>) => {
      const row = { id: GUEST_ID, ...structuredClone(dto) };
      state.guests.push(row);
      return row;
    }),
  };
  const reservation = {
    lockInventory: vi.fn(async () => undefined),
    create: vi.fn(async (dto: Record<string, unknown>) => {
      reservationCreates += 1;
      if (!hasAvailability) {
        throw new BadRequestException('No availability for requested stay');
      }
      const row = {
        id: RESERVATION_ID,
        bookingId: '33333333-0000-4000-a000-000000000001',
        status: 'pending',
        ...structuredClone(dto),
      };
      state.reservations.push(row);
      return row;
    }),
  };
  const folio = {
    createAutoFolio: vi.fn(async (input: Record<string, unknown>) => {
      const row = {
        id: FOLIO_ID,
        propertyId: input['propertyId'],
        reservationId: input['id'],
        guestId: input['guestId'],
        currencyCode: input['currencyCode'],
      };
      state.folios.push(row);
      return row;
    }),
    recalculateBalance: vi.fn(async () => undefined),
  };
  const ancillary = {
    attachToReservation: vi.fn(async () => ({
      id: '44444444-0000-4000-a000-000000000001',
    })),
    ensurePackageComponents: vi.fn(async () => []),
  };
  const emailQueueTransactionStates: boolean[] = [];
  const emailDeliveryTransactionStates: boolean[] = [];
  const mailer = {
    queue: vi.fn(async () => {
      emailQueueTransactionStates.push(database.isTransactionActive());
      return 'email-delivery-1';
    }),
    deliverForRequestBestEffort: vi.fn(async () => {
      emailDeliveryTransactionStates.push(database.isTransactionActive());
    }),
  };

  const service = new (BookingRequestService as any)(
    database.db,
    config,
    bookingEngine,
    availability,
    ratePlan,
    savedPaymentMethod,
    webhook,
    guest,
    reservation,
    folio,
    ancillary,
    mailer,
  ) as BookingRequestService & Record<string, (...args: any[]) => Promise<any>>;

  return {
    service,
    state,
    database,
    bookingEngine,
    savedPaymentMethod,
    webhook,
    guest,
    reservation,
    folio,
    ancillary,
    mailer,
    emailQueueTransactionStates,
    emailDeliveryTransactionStates,
    setAvailability(value: boolean) {
      hasAvailability = value;
    },
    get reservationCreates() {
      return reservationCreates;
    },
    dispatchTransactionStates,
    quoteTransactionStates,
  };
}

async function call(
  service: BookingRequestService & Record<string, (...args: any[]) => Promise<any>>,
  method: 'list' | 'findById' | 'auditHistory' | 'acceptancePreview' | 'accept' | 'deny',
  args: unknown[],
): Promise<any> {
  const fn = service[method];
  if (typeof fn !== 'function') return undefined;
  return fn.apply(service, args);
}

const actor = {
  userId: '55555555-0000-4000-a000-000000000001',
  userEmail: 'agent@example.com',
  ipAddress: '203.0.113.10',
};

describe('Booking Request staff HTTP contract', () => {
  it('registers concrete DTO validation and read/write permissions', async () => {
    const controllerModule = await import('./booking-request.controller').catch(() => null);
    const listDtoModule = await import('./dto/list-booking-requests.dto').catch(() => null);
    const acceptDtoModule = await import('./dto/accept-booking-request.dto').catch(() => null);
    const denyDtoModule = await import('./dto/deny-booking-request.dto').catch(() => null);

    expect(controllerModule).not.toBeNull();
    expect(listDtoModule).not.toBeNull();
    expect(acceptDtoModule).not.toBeNull();
    expect(denyDtoModule).not.toBeNull();
    if (!controllerModule || !listDtoModule || !acceptDtoModule || !denyDtoModule) return;

    const Controller = controllerModule.BookingRequestController;
    const reflector = new Reflector();
    expect(reflector.get(PERMISSIONS_KEY, Controller.prototype.list)).toEqual([
      'reservations.read',
    ]);
    expect(reflector.get(PERMISSIONS_KEY, Controller.prototype.findById)).toEqual([
      'reservations.read',
    ]);
    expect(reflector.get(PERMISSIONS_KEY, Controller.prototype.acceptancePreview)).toEqual([
      'reservations.read',
    ]);
    expect(reflector.get(PERMISSIONS_KEY, Controller.prototype.auditHistory)).toEqual([
      'reservations.read',
    ]);
    expect(reflector.get(PERMISSIONS_KEY, Controller.prototype.accept)).toEqual([
      'reservations.write',
    ]);
    expect(reflector.get(PERMISSIONS_KEY, Controller.prototype.deny)).toEqual([
      'reservations.write',
    ]);

    expect(Reflect.getMetadata(
      'design:paramtypes',
      Controller.prototype,
      'accept',
    )).toContain(acceptDtoModule.AcceptBookingRequestDto);
    expect(Reflect.getMetadata(
      'design:paramtypes',
      Controller.prototype,
      'deny',
    )).toContain(denyDtoModule.DenyBookingRequestDto);
  });

  it('requires property scope and validates custom pricing/denial input', async () => {
    const listDtoModule = await import('./dto/list-booking-requests.dto').catch(() => null);
    const acceptDtoModule = await import('./dto/accept-booking-request.dto').catch(() => null);
    const denyDtoModule = await import('./dto/deny-booking-request.dto').catch(() => null);
    expect(listDtoModule && acceptDtoModule && denyDtoModule).toBeTruthy();
    if (!listDtoModule || !acceptDtoModule || !denyDtoModule) return;

    const missingScope = await validate(plainToInstance(
      listDtoModule.ListBookingRequestsDto,
      {},
    ));
    const invalidSource = await validate(plainToInstance(
      acceptDtoModule.AcceptBookingRequestDto,
      { priceSource: 'charged' },
    ));
    const missingPreview = await validate(plainToInstance(
      acceptDtoModule.AcceptBookingRequestDto,
      { priceSource: 'current' },
    ));
    const blankDenial = await validate(plainToInstance(
      denyDtoModule.DenyBookingRequestDto,
      { reason: '' },
    ));
    const invalidSort = await validate(plainToInstance(
      listDtoModule.ListBookingRequestsDto,
      { propertyId: PROPERTY_ID, sortBy: 'privateField', sortOrder: 'sideways' },
    ));
    expect(missingScope.some((error) => error.property === 'propertyId')).toBe(true);
    expect(invalidSource.some((error) => error.property === 'priceSource')).toBe(true);
    expect(missingPreview.some((error) => error.property === 'previewToken')).toBe(true);
    expect(blankDenial.some((error) => error.property === 'reason')).toBe(true);
    expect(invalidSort.map((error) => error.property)).toEqual(expect.arrayContaining([
      'sortBy',
      'sortOrder',
    ]));
  });
});

describe('BookingRequestService staff reads', () => {
  it('applies requested-total numeric ordering in SQL before page boundaries', async () => {
    const harness = makeHarness(Array.from({ length: 25 }, (_, index) => pendingRequest({
      id: `bbbbbbbb-0000-4000-a000-${String(index + 1).padStart(12, '0')}`,
      submittedQuoteSnapshot: { grandTotal: String(index === 0 ? 9 : index * 10) },
    })));

    await call(harness.service, 'list', [{
      propertyId: PROPERTY_ID,
      page: 2,
      limit: 20,
      sortBy: 'requestedTotal',
      sortOrder: 'desc',
    }]);

    const listSelect = vi.mocked((harness.database.db as any).select).mock.results[0]?.value;
    expect(listSelect.orderBy).toHaveBeenCalledTimes(1);
    expect(listSelect.orderBy.mock.invocationCallOrder[0]).toBeLessThan(
      listSelect.limit.mock.invocationCallOrder[0],
    );
    const directionSql = listSelect.orderBy.mock.calls[0]?.[0];
    const requestedTotalSql = directionSql.queryChunks.find((chunk: any) => chunk.queryChunks);
    expect(requestedTotalSql.queryChunks[0]?.value).toEqual(['cast(']);
    expect(requestedTotalSql.queryChunks.at(-1)?.value)
      .toEqual(["->>'grandTotal' as numeric)"]);
    expect(listSelect.limit).toHaveBeenCalledWith(20);
    expect(listSelect.offset).toHaveBeenCalledWith(20);
  });

  it('lists only the requested property and never leaks cross-property rows', async () => {
    const harness = makeHarness([
      pendingRequest(),
      pendingRequest({ id: 'bbbbbbbb-0000-4000-a000-000000000002', propertyId: OTHER_PROPERTY_ID }),
    ]);
    const result = await call(harness.service, 'list', [{
      propertyId: PROPERTY_ID,
      page: 1,
      limit: 20,
    }]);

    expect(result?.data?.map((row: RequestRow) => row.id)).toEqual([REQUEST_ID]);
  });

  it('serializes list and detail through explicit safe shapes', async () => {
    const request = pendingRequest();
    Object.assign(request, {
      submissionIdempotencyKey: 'do-not-leak-key',
      submissionFingerprint: 'do-not-leak-fingerprint',
      setupIntentId: 'seti_secret',
      stripeCustomerId: 'cus_secret',
      stripePaymentMethodId: 'pm_secret',
      cardLastFour: '4242',
      cardBrand: 'visa',
      consentText: 'internal consent wording',
      consentVersion: 'v-secret',
      consentedAt: new Date(),
      formSnapshot: [{ id: 'question-1', label: 'Internal prompt' }],
      applicationAnswers: { 'question-1': 'Approved admin answer' },
    });
    const harness = makeHarness([request]);

    const list = await call(harness.service, 'list', [{
      propertyId: PROPERTY_ID,
      page: 1,
      limit: 20,
    }]);
    const detail = await call(harness.service, 'findById', [REQUEST_ID, PROPERTY_ID]);
    const forbiddenKeys = [
      'submissionIdempotencyKey',
      'submissionFingerprint',
      'setupIntentId',
      'stripeCustomerId',
      'stripePaymentMethodId',
      'consentText',
      'consentVersion',
      'consentedAt',
    ];

    expect(list.data[0]).toEqual(expect.objectContaining({
      id: REQUEST_ID,
      hasCard: true,
      submittedTotal: '220.00',
      currencyCode: 'EUR',
    }));
    expect(Object.keys(list.data[0]).sort()).toEqual([
      'acceptedPriceSource', 'acceptedReservationId', 'acceptedTotal', 'adults',
      'arrivalDate', 'children', 'createdAt', 'departureDate', 'guestEmail',
      'guestFirstName', 'guestLastName', 'hasCard', 'id', 'propertyId',
      'ratePlanId', 'roomTypeId', 'status', 'submittedTotal', 'currencyCode',
      'updatedAt',
    ].sort());
    expect(detail.card).toEqual({ brand: 'visa', lastFour: '4242' });
    expect(detail.applicationAnswers).toEqual({
      'question-1': 'Approved admin answer',
    });
    expect(Object.keys(detail)).toEqual(expect.arrayContaining([
      'submittedQuoteSnapshot',
      'currentQuoteSnapshot',
      'formSnapshot',
      'applicationAnswers',
    ]));
    for (const key of forbiddenKeys) {
      expect(JSON.stringify(list)).not.toContain(key);
      expect(JSON.stringify(detail)).not.toContain(key);
      expect(detail).not.toHaveProperty(key);
    }
  });

  it('returns not found for a request id that exists under another property', async () => {
    const harness = makeHarness([
      pendingRequest({ propertyId: OTHER_PROPERTY_ID }),
    ]);

    await expect(call(
      harness.service,
      'findById',
      [REQUEST_ID, PROPERTY_ID],
    )).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns a bounded stable page of request-owned audit rows', async () => {
    const harness = makeHarness();
    harness.state.audits.push(
      ...[1, 2, 3].map((sequence) => ({
        id: `10000000-0000-4000-a000-00000000000${sequence}`,
        propertyId: PROPERTY_ID,
        action: 'update',
        entityType: 'booking_request',
        entityId: REQUEST_ID,
        newValue: { status: sequence === 1 ? 'accepted' : 'pending' },
        occurredAt: new Date(`2026-08-25T10:0${sequence}:00.000Z`),
      })),
      {
        id: '10000000-0000-4000-a000-000000000099',
        propertyId: PROPERTY_ID,
        action: 'update',
        entityType: 'booking_request',
        entityId: 'bbbbbbbb-0000-4000-a000-000000000099',
        newValue: { status: 'accepted' },
        occurredAt: new Date('2026-08-25T10:09:00.000Z'),
      },
    );

    const result = await call(harness.service, 'auditHistory', [
      REQUEST_ID,
      PROPERTY_ID,
      { limit: 2 },
    ]);

    expect(result.data).toHaveLength(2);
    expect(result.data.every((row: { id: string }) => row.id !== '10000000-0000-4000-a000-000000000099'))
      .toBe(true);
    expect(result.nextCursor).toEqual(expect.any(String));
    const selectCalls = (harness.database.db['select'] as ReturnType<typeof vi.fn>).mock.results;
    const auditQuery = selectCalls.at(-1)?.value as {
      limit: ReturnType<typeof vi.fn>;
    };
    expect(auditQuery.limit).toHaveBeenCalledWith(3);
  });

  it('uses an opaque keyset cursor so a newer append cannot duplicate or skip older rows', async () => {
    const harness = makeHarness();
    harness.state.audits.push(...[1, 2, 3].map((sequence) => ({
      id: `10000000-0000-4000-a000-00000000003${sequence}`,
      propertyId: PROPERTY_ID,
      bookingRequestId: REQUEST_ID,
      action: 'update',
      entityType: 'booking_request',
      entityId: REQUEST_ID,
      newValue: { status: 'pending' },
      occurredAt: new Date(`2026-08-25T10:0${sequence}:00.000Z`),
    })));

    const first = await call(harness.service, 'auditHistory', [
      REQUEST_ID,
      PROPERTY_ID,
      { limit: 2 },
    ]);
    harness.state.audits.push({
      id: '10000000-0000-4000-a000-000000000034',
      propertyId: PROPERTY_ID,
      bookingRequestId: REQUEST_ID,
      action: 'update',
      entityType: 'booking_request',
      entityId: REQUEST_ID,
      newValue: { status: 'accepted' },
      occurredAt: new Date('2026-08-25T10:04:00.000Z'),
    });
    const second = await call(harness.service, 'auditHistory', [
      REQUEST_ID,
      PROPERTY_ID,
      { limit: 2, cursor: first.nextCursor },
    ]);

    expect(first.data.map((row: { id: string }) => row.id)).toEqual([
      '10000000-0000-4000-a000-000000000033',
      '10000000-0000-4000-a000-000000000032',
    ]);
    expect(second.data.map((row: { id: string }) => row.id)).toEqual([
      '10000000-0000-4000-a000-000000000031',
    ]);
    expect(new Set([...first.data, ...second.data].map((row: { id: string }) => row.id)).size)
      .toBe(3);
    expect(second.nextCursor).toBeNull();
  });

  it('keeps PostgreSQL microseconds in the opaque audit cursor and total ordering', async () => {
    const harness = makeHarness();
    harness.state.audits.push(
      {
        id: '10000000-0000-4000-a000-000000000041',
        propertyId: PROPERTY_ID,
        bookingRequestId: REQUEST_ID,
        action: 'update',
        entityType: 'booking_request',
        entityId: REQUEST_ID,
        newValue: { status: 'accepted' },
        occurredAt: new Date('2026-08-25T10:00:00.000Z'),
        occurredAtMicros: '1787652000000900',
      },
      {
        id: '10000000-0000-4000-a000-000000000043',
        propertyId: PROPERTY_ID,
        bookingRequestId: REQUEST_ID,
        action: 'update',
        entityType: 'booking_request',
        entityId: REQUEST_ID,
        newValue: { status: 'pending' },
        occurredAt: new Date('2026-08-25T10:00:00.000Z'),
        occurredAtMicros: '1787652000000800',
      },
      {
        id: '10000000-0000-4000-a000-000000000042',
        propertyId: PROPERTY_ID,
        bookingRequestId: REQUEST_ID,
        action: 'update',
        entityType: 'booking_request',
        entityId: REQUEST_ID,
        newValue: { status: 'pending' },
        occurredAt: new Date('2026-08-25T10:00:00.000Z'),
        occurredAtMicros: '1787652000000700',
      },
    );

    const first = await call(harness.service, 'auditHistory', [
      REQUEST_ID,
      PROPERTY_ID,
      { limit: 2 },
    ]);
    const decodedCursor = JSON.parse(
      Buffer.from(first.nextCursor, 'base64url').toString('utf8'),
    );
    const second = await call(harness.service, 'auditHistory', [
      REQUEST_ID,
      PROPERTY_ID,
      { limit: 2, cursor: first.nextCursor },
    ]);

    expect(first.data.map((row: { id: string }) => row.id)).toEqual([
      '10000000-0000-4000-a000-000000000041',
      '10000000-0000-4000-a000-000000000043',
    ]);
    expect(decodedCursor).toMatchObject({
      occurredAtMicros: '1787652000000800',
      source: 'audit_log',
      id: '10000000-0000-4000-a000-000000000043',
    });
    expect(decodedCursor).not.toHaveProperty('occurredAt');
    expect(second.data.map((row: { id: string }) => row.id)).toEqual([
      '10000000-0000-4000-a000-000000000042',
    ]);
  });

  it('rejects a malformed audit cursor before querying audit rows', async () => {
    const harness = makeHarness();

    await expect(call(harness.service, 'auditHistory', [
      REQUEST_ID,
      PROPERTY_ID,
      { limit: 25, cursor: 'not-an-audit-cursor' },
    ])).rejects.toThrow(/invalid booking request audit cursor/i);
  });

  it('includes request-owned audit rows even when a legacy payload omits the request id', async () => {
    const harness = makeHarness();
    harness.state.payments.push({
      id: PAYMENT_ID,
      propertyId: PROPERTY_ID,
      bookingRequestId: REQUEST_ID,
    });
    harness.state.audits.push({
      id: '10000000-0000-4000-a000-000000000010',
      propertyId: PROPERTY_ID,
      action: 'update',
      entityType: 'payment',
      entityId: PAYMENT_ID,
      newValue: { status: 'settled', amount: '80.00', currencyCode: 'EUR' },
      description: 'Legacy payment settled',
      occurredAt: new Date('2026-08-25T10:10:00.000Z'),
    });

    const page = await call(harness.service, 'auditHistory', [REQUEST_ID, PROPERTY_ID]);

    expect(page.data).toEqual([
      expect.objectContaining({
        id: '10000000-0000-4000-a000-000000000010',
        summary: 'payment.updated',
      }),
    ]);
  });

  it('keeps directly related installment and allocation tombstones after child deletion', async () => {
    const harness = makeHarness();
    harness.state.audits.push({
      id: '10000000-0000-4000-a000-000000000021',
      propertyId: PROPERTY_ID,
      bookingRequestId: REQUEST_ID,
      action: 'delete',
      entityType: 'booking_request_installment',
      entityId: '20000000-0000-4000-a000-000000000021',
      previousValue: { label: 'Deleted deposit', fixedAmount: '40.00' },
      description: 'Booking request installment deleted',
      occurredAt: new Date('2026-08-25T10:21:00.000Z'),
    }, {
      id: '10000000-0000-4000-a000-000000000022',
      propertyId: PROPERTY_ID,
      bookingRequestId: REQUEST_ID,
      action: 'delete',
      entityType: 'booking_request_payment_allocation',
      entityId: '20000000-0000-4000-a000-000000000022',
      previousValue: { amount: '40.00' },
      description: 'Booking request allocation removed',
      occurredAt: new Date('2026-08-25T10:22:00.000Z'),
    });

    const page = await call(harness.service, 'auditHistory', [REQUEST_ID, PROPERTY_ID]);

    expect(page.data.map((row: { id: string }) => row.id)).toEqual([
      '10000000-0000-4000-a000-000000000022',
      '10000000-0000-4000-a000-000000000021',
    ]);
    expect(JSON.stringify(page.data)).not.toContain('bookingRequestId');
  });

  it('returns immutable related audit rows through an explicit sanitized DTO', async () => {
    const harness = makeHarness();
    harness.state.installments.push({
      id: '20000000-0000-4000-a000-000000000001',
      propertyId: PROPERTY_ID,
      bookingRequestId: REQUEST_ID,
    });
    harness.state.payments.push({
      id: PAYMENT_ID,
      propertyId: PROPERTY_ID,
      bookingRequestId: REQUEST_ID,
    });
    harness.state.emailDeliveries.push({
      id: '30000000-0000-4000-a000-000000000001',
      propertyId: PROPERTY_ID,
      bookingRequestId: REQUEST_ID,
    });
    harness.state.audits.push(
      {
        id: '10000000-0000-4000-a000-000000000001',
        propertyId: PROPERTY_ID,
        action: 'update',
        entityType: 'booking_request',
        entityId: REQUEST_ID,
        userId: actor.userId,
        userEmail: actor.userEmail,
        previousValue: { status: 'pending', consentText: 'secret consent' },
        newValue: {
          status: 'accepted',
          acceptedTotal: '240.00',
          priceSource: 'custom',
          processorToken: 'tok_secret',
        },
        description: 'Booking request accepted',
        occurredAt: new Date('2026-08-25T10:00:00.000Z'),
      },
      {
        id: '10000000-0000-4000-a000-000000000002',
        propertyId: PROPERTY_ID,
        action: 'create',
        entityType: 'booking_request_installment',
        entityId: '20000000-0000-4000-a000-000000000001',
        userEmail: null,
        newValue: {
          requestId: REQUEST_ID,
          label: 'Deposit',
          fixedAmount: '80.00',
          applicationAnswers: { passport: 'secret' },
        },
        description: 'Booking request installment created',
        occurredAt: new Date('2026-08-25T10:01:00.000Z'),
      },
      {
        id: '10000000-0000-4000-a000-000000000003',
        propertyId: PROPERTY_ID,
        action: 'create',
        entityType: 'payment',
        entityId: PAYMENT_ID,
        userEmail: actor.userEmail,
        newValue: {
          requestId: REQUEST_ID,
          amount: '80.00',
          currencyCode: 'EUR',
          status: 'captured',
          gatewayTransactionId: 'pi_secret',
        },
        description: 'Booking request saved-card charge captured',
        occurredAt: new Date('2026-08-25T10:02:00.000Z'),
      },
      {
        id: '10000000-0000-4000-a000-000000000004',
        propertyId: PROPERTY_ID,
        action: 'create',
        entityType: 'booking_request_email_delivery',
        entityId: '30000000-0000-4000-a000-000000000001',
        newValue: { bookingRequestId: REQUEST_ID, kind: 'accepted', status: 'pending' },
        description: 'Booking request accepted email queued',
        occurredAt: new Date('2026-08-25T10:03:00.000Z'),
      },
      {
        id: '10000000-0000-4000-a000-000000000005',
        propertyId: PROPERTY_ID,
        action: 'update',
        entityType: 'booking_request_email_delivery',
        entityId: '30000000-0000-4000-a000-000000000001',
        newValue: { status: 'sent', attempts: 2, providerMessageId: 'msg_secret' },
        description: 'Booking request email delivered',
        occurredAt: new Date('2026-08-25T10:04:00.000Z'),
      },
      {
        id: '10000000-0000-4000-a000-000000000006',
        propertyId: OTHER_PROPERTY_ID,
        action: 'create',
        entityType: 'payment',
        entityId: PAYMENT_ID,
        newValue: { requestId: REQUEST_ID, processorToken: 'cross-property-secret' },
        description: 'Unrelated payment',
        occurredAt: new Date('2026-08-25T10:05:00.000Z'),
      },
      {
        id: '10000000-0000-4000-a000-000000000007',
        propertyId: PROPERTY_ID,
        action: 'update',
        entityType: 'booking_request_email_delivery',
        entityId: '30000000-0000-4000-a000-000000000001',
        newValue: { status: 'provider_secret_state' },
        description: 'Booking request email state changed',
        occurredAt: new Date('2026-08-25T10:06:00.000Z'),
      },
    );

    const page = await call(harness.service, 'auditHistory', [REQUEST_ID, PROPERTY_ID]);
    const result = page.data;

    expect(result).toHaveLength(6);
    expect(page.nextCursor).toBeNull();
    expect(result.find((entry: { summary: string }) => entry.summary === 'request.accepted')).toMatchObject({
      action: 'update',
      actorDisplay: actor.userEmail,
      summary: 'request.accepted',
      details: { status: 'accepted', acceptedTotal: '240.00', priceSource: 'custom' },
    });
    expect(result.map((entry: { summary: string }) => entry.summary)).toEqual(expect.arrayContaining([
      'installment.created',
      'payment.captured',
      'email.pending',
      'email.sent',
      'email.updated',
    ]));
    const serialized = JSON.stringify(result);
    for (const forbidden of [
      'processorToken', 'tok_secret', 'gatewayTransactionId', 'pi_secret',
      'providerMessageId', 'msg_secret', 'consentText', 'applicationAnswers',
      'cross-property-secret', actor.userId,
    ]) expect(serialized).not.toContain(forbidden);
  });
});

describe('BookingRequestService acceptance', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it('previews only submitted/current totals and an opaque property-scoped fingerprint', async () => {
    const harness = makeHarness();

    const preview = await call(harness.service, 'acceptancePreview', [
      REQUEST_ID,
      PROPERTY_ID,
    ]);

    expect(preview).toEqual({
      requestId: REQUEST_ID,
      submittedTotal: '220.00',
      currentTotal: '260.00',
      currencyCode: 'EUR',
      previewVersion: 1,
      previewToken: previewToken(),
    });
    expect(JSON.stringify(preview)).not.toContain('lineItems');
    expect(harness.quoteTransactionStates).toEqual([false]);
  });

  it.each([
    ['submitted', undefined, undefined, '220.00'],
    ['current', undefined, undefined, '260.00'],
    ['custom', '240.00', 'Goodwill rate', '240.00'],
  ] as const)(
    'accepts the %s price without charging and records the decision actor',
    async (priceSource, customTotal, customReason, expectedTotal) => {
      const harness = makeHarness();
      const result = await call(harness.service, 'accept', [
        REQUEST_ID,
        PROPERTY_ID,
        { priceSource, customTotal, customReason, previewToken: previewToken() },
        actor,
      ]);

      expect(result).toEqual({
        requestId: REQUEST_ID,
        status: 'accepted',
        reservationId: RESERVATION_ID,
        folioId: FOLIO_ID,
        totalAmount: expectedTotal,
        currencyCode: 'EUR',
        priceSource,
        customReason: customReason ?? null,
      });
      expect(harness.state.requests[0]).toMatchObject({
        status: 'accepted',
        acceptedPriceSource: priceSource,
        acceptedTotal: expectedTotal,
        customPriceReason: customReason ?? null,
        acceptedReservationId: RESERVATION_ID,
        acceptedFolioId: FOLIO_ID,
        decidedBy: actor.userId,
        currentQuoteSnapshot: currentQuote,
      });
      expect(harness.savedPaymentMethod.charge).not.toHaveBeenCalled();
      expect(harness.reservation.create.mock.calls[0]?.[1]).toMatchObject({
        acceptedPricingSnapshot: expect.objectContaining({
          source: priceSource,
          currencyCode: 'EUR',
          grandTotal: expectedTotal,
        }),
      });
      expect(harness.state.audits).toContainEqual(expect.objectContaining({
        userId: actor.userId,
        userEmail: actor.userEmail,
        ipAddress: actor.ipAddress,
      }));
      expect(harness.state.audits.map((entry) => entry['description'])).toEqual(
        expect.arrayContaining([
          'Webhook event: booking_request.accepted',
          'Webhook event: reservation.created',
          'Webhook event: folio.created',
        ]),
      );
      expect(harness.state.consequences).toContainEqual(expect.objectContaining({
        kind: 'accepted_event',
        payload: expect.objectContaining({
          event: 'booking_request.accepted',
          data: expect.objectContaining({ currencyCode: 'EUR' }),
        }),
      }));
      expect(harness.quoteTransactionStates).toEqual([true]);
      expect(harness.dispatchTransactionStates.every((active) => !active)).toBe(true);
    },
  );

  it('rejects custom pricing without a reason before creating business records', async () => {
    const harness = makeHarness();

    await expect(call(harness.service, 'accept', [
      REQUEST_ID,
      PROPERTY_ID,
      { priceSource: 'custom', customTotal: '240.00', previewToken: previewToken() },
      actor,
    ])).rejects.toThrow(/reason/i);
    expect(harness.state.requests[0]?.status).toBe('pending');
    expect(harness.state.reservations).toHaveLength(0);
    expect(harness.state.guests).toHaveLength(0);
  });

  it('rejects custom totals with excess currency precision instead of rounding them', async () => {
    const harness = makeHarness();

    await expect(call(harness.service, 'accept', [
      REQUEST_ID,
      PROPERTY_ID,
      {
        priceSource: 'custom',
        customTotal: '240.001',
        customReason: 'Must remain exact',
        previewToken: previewToken(),
      },
      actor,
    ])).rejects.toThrow(/minor units|precision/i);
    expect(harness.state.requests[0]?.status).toBe('pending');
    expect(harness.state.reservations).toHaveLength(0);
  });

  it('persists, audits, and returns an equal-total custom reason independently of adjustment', async () => {
    const harness = makeHarness();

    const result = await call(harness.service, 'accept', [
      REQUEST_ID,
      PROPERTY_ID,
      {
        priceSource: 'custom',
        customTotal: '260.00',
        customReason: 'Matched a written offer',
        previewToken: previewToken(),
      },
      actor,
    ]);

    expect(result).toMatchObject({
      requestId: REQUEST_ID,
      status: 'accepted',
      priceSource: 'custom',
      customReason: 'Matched a written offer',
      totalAmount: '260.00',
    });
    expect(harness.state.requests[0]).toMatchObject({
      acceptedPriceSource: 'custom',
      acceptedTotal: '260.00',
      customPriceReason: 'Matched a written offer',
    });
    expect(harness.reservation.create.mock.calls[0]?.[1]).toMatchObject({
      acceptedPricingSnapshot: expect.objectContaining({
        source: 'custom',
        customReason: 'Matched a written offer',
        adjustment: null,
      }),
    });
    expect(harness.state.audits).toContainEqual(expect.objectContaining({
      description: 'Booking request accepted',
      newValue: expect.objectContaining({
        priceSource: 'custom',
        customPriceReason: 'Matched a written offer',
      }),
    }));
  });

  it('leaves the request pending when canonical reservation creation finds no availability', async () => {
    const harness = makeHarness();
    harness.setAvailability(false);

    const acceptance = call(harness.service, 'accept', [
      REQUEST_ID,
      PROPERTY_ID,
      { priceSource: 'current', previewToken: previewToken() },
      actor,
    ]);
    await expect(acceptance).rejects.toBeInstanceOf(ConflictException);
    await expect(acceptance).rejects.toThrow(/availability/i);
    expect(harness.state.requests[0]?.status).toBe('pending');
    expect(harness.state.reservations).toHaveLength(0);
    expect(harness.state.folios).toHaveLength(0);
  });

  it('returns a conflict and leaves the request pending when the pre-transaction quote finds no availability', async () => {
    const harness = makeHarness();
    harness.bookingEngine.quote.mockRejectedValueOnce(
      new BadRequestException('No availability for the requested room type and dates'),
    );

    await expect(call(harness.service, 'accept', [
      REQUEST_ID,
      PROPERTY_ID,
      { priceSource: 'submitted', previewToken: previewToken() },
      actor,
    ])).rejects.toBeInstanceOf(ConflictException);
    expect(harness.state.requests[0]?.status).toBe('pending');
    expect(harness.state.reservations).toHaveLength(0);
  });

  it('rejects a current quote in a different currency without creating records', async () => {
    const harness = makeHarness();
    harness.bookingEngine.quote.mockResolvedValueOnce({
      ...structuredClone(currentQuote),
      currencyCode: 'USD',
    });

    await expect(call(harness.service, 'accept', [
      REQUEST_ID,
      PROPERTY_ID,
      { priceSource: 'current', previewToken: previewToken({ ...currentQuote, currencyCode: 'USD' }) },
      actor,
    ])).rejects.toThrow(/currency/i);
    expect(harness.state.requests[0]?.status).toBe('pending');
    expect(harness.state.reservations).toHaveLength(0);
  });

  it('rejects a legacy scale-three request before accepting it into ledger-backed records', async () => {
    const bhdQuote = {
      ...structuredClone(currentQuote),
      currencyCode: 'BHD',
      grandTotal: '260.000',
    };
    const harness = makeHarness([pendingRequest({
      currencyCode: 'BHD',
      submittedQuoteSnapshot: {
        ...structuredClone(submittedQuote),
        currencyCode: 'BHD',
        grandTotal: '220.000',
      },
    })]);
    harness.bookingEngine.quote.mockResolvedValue(bhdQuote);

    const acceptance = call(harness.service, 'accept', [
      REQUEST_ID,
      PROPERTY_ID,
      { priceSource: 'submitted', previewToken: previewToken(bhdQuote, harness.state.requests[0]!) },
      actor,
    ]);
    await expect(acceptance).rejects.toBeInstanceOf(ConflictException);
    await expect(acceptance).rejects.toThrow(/BHD.*scale-two payment ledger/i);
    expect(harness.state.requests[0]?.status).toBe('pending');
    expect(harness.state.reservations).toHaveLength(0);
    expect(harness.state.folios).toHaveLength(0);
  });

  it('rejects acceptance when the authoritative quote changes after preview', async () => {
    const harness = makeHarness();
    const preview = await call(harness.service, 'acceptancePreview', [
      REQUEST_ID,
      PROPERTY_ID,
    ]);
    harness.bookingEngine.quote.mockResolvedValueOnce({
      ...structuredClone(currentQuote),
      roomTotal: '260.00',
      grandTotal: '280.00',
      lineItems: [
        { date: '2026-10-01', rate: '130.00', tax: '10.00' },
        { date: '2026-10-02', rate: '130.00', tax: '10.00' },
      ],
    });

    await expect(call(harness.service, 'accept', [
      REQUEST_ID,
      PROPERTY_ID,
      { priceSource: 'current', previewToken: preview.previewToken },
      actor,
    ])).rejects.toThrow(/preview.*changed/i);
    expect(harness.state.requests[0]?.status).toBe('pending');
    expect(harness.state.reservations).toHaveLength(0);
    expect(harness.state.guests).toHaveLength(0);
  });

  it('serializes simultaneous acceptance and creates exactly one reservation', async () => {
    const harness = makeHarness();

    const [first, second] = await Promise.all([
      call(harness.service, 'accept', [
        REQUEST_ID,
        PROPERTY_ID,
        { priceSource: 'submitted', previewToken: previewToken() },
        actor,
      ]),
      call(harness.service, 'accept', [
        REQUEST_ID,
        PROPERTY_ID,
        { priceSource: 'submitted', previewToken: previewToken() },
        actor,
      ]),
    ]);

    expect(first).toEqual(second);
    expect(first).toEqual({
      requestId: REQUEST_ID,
      status: 'accepted',
      reservationId: RESERVATION_ID,
      folioId: FOLIO_ID,
      totalAmount: '220.00',
      currencyCode: 'EUR',
      priceSource: 'submitted',
      customReason: null,
    });
    expect(harness.reservationCreates).toBe(1);
    expect(harness.state.reservations).toHaveLength(1);
    expect(harness.mailer.queue).toHaveBeenCalledWith(expect.objectContaining({
      logicalKey: 'decision:accepted',
      kind: 'accepted',
      recipient: 'ada@example.com',
    }), expect.anything());
    expect(harness.emailQueueTransactionStates).toEqual([true]);
    expect(harness.emailDeliveryTransactionStates.every((active) => !active)).toBe(true);
  });

  it('keeps one of two different requests pending when they compete for the last room', async () => {
    const otherRequestId = 'bbbbbbbb-0000-4000-a000-000000000002';
    const first = makeHarness([pendingRequest()]);
    const second = makeHarness([pendingRequest({ id: otherRequestId })]);
    let inventoryAvailable = true;
    let inventoryQueue = Promise.resolve();

    const useSharedInventory = (harness: ReturnType<typeof makeHarness>) => {
      let releaseInventory: (() => void) | undefined;
      const createReservation = harness.reservation.create.getMockImplementation()!;
      harness.reservation.lockInventory.mockImplementation(async () => {
        const previous = inventoryQueue;
        inventoryQueue = new Promise<void>((resolve) => {
          releaseInventory = resolve;
        });
        await previous;
      });
      harness.bookingEngine.quote.mockImplementation(async () => {
        if (!inventoryAvailable) {
          releaseInventory?.();
          throw new BadRequestException('No availability for requested stay');
        }
        return structuredClone(currentQuote);
      });
      harness.reservation.create.mockImplementation(async (...args: any[]) => {
        const reservation = await createReservation(...args);
        inventoryAvailable = false;
        releaseInventory?.();
        return reservation;
      });
    };
    useSharedInventory(first);
    useSharedInventory(second);

    const results = await Promise.allSettled([
      call(first.service, 'accept', [
        REQUEST_ID,
        PROPERTY_ID,
        { priceSource: 'current', previewToken: previewToken() },
        actor,
      ]),
      call(second.service, 'accept', [
        otherRequestId,
        PROPERTY_ID,
        { priceSource: 'current', previewToken: previewToken() },
        actor,
      ]),
    ]);

    expect(results.map((result) => result.status).sort()).toEqual([
      'fulfilled',
      'rejected',
    ]);
    expect([
      first.state.requests[0]?.status,
      second.state.requests[0]?.status,
    ].sort()).toEqual(['accepted', 'pending']);
    expect(first.state.reservations.length + second.state.reservations.length).toBe(1);
  });

  it('returns the linked reservation when an accepted request is replayed', async () => {
    const accepted = pendingRequest({
      status: 'accepted',
      acceptedReservationId: RESERVATION_ID,
      acceptedFolioId: FOLIO_ID,
      acceptedPriceSource: 'submitted',
      acceptedTotal: '220.00',
    });
    const harness = makeHarness([accepted]);
    harness.state.reservations.push({
      id: RESERVATION_ID,
      propertyId: PROPERTY_ID,
      totalAmount: '220.00',
    });

    const result = await call(harness.service, 'accept', [
      REQUEST_ID,
      PROPERTY_ID,
      { priceSource: 'submitted', previewToken: previewToken() },
      actor,
    ]);

    expect(result).toEqual({
      requestId: REQUEST_ID,
      status: 'accepted',
      reservationId: RESERVATION_ID,
      folioId: FOLIO_ID,
      totalAmount: '220.00',
      currencyCode: 'EUR',
      priceSource: 'submitted',
      customReason: null,
    });
    expect(harness.reservationCreates).toBe(0);
  });

  it('links pre-acceptance payments to the new folio without losing request provenance', async () => {
    const harness = makeHarness();
    harness.state.payments.push({
      id: PAYMENT_ID,
      propertyId: PROPERTY_ID,
      bookingRequestId: REQUEST_ID,
      folioId: null,
      status: 'captured',
      amount: '100.00',
    });

    await call(harness.service, 'accept', [
      REQUEST_ID,
      PROPERTY_ID,
      { priceSource: 'submitted', previewToken: previewToken() },
      actor,
    ]);

    expect(harness.state.payments[0]).toMatchObject({
      id: PAYMENT_ID,
      bookingRequestId: REQUEST_ID,
      folioId: FOLIO_ID,
    });
  });

  it('persists selected and package ancillary events with the canonical payload contract', async () => {
    const serviceId = '99999999-0000-4000-a000-000000000001';
    const packageServiceId = '99999999-0000-4000-a000-000000000002';
    const harness = makeHarness([
      pendingRequest({ serviceIds: [serviceId] }),
    ]);
    const acceptedQuote = {
      ...structuredClone(currentQuote),
      services: [{
        serviceId,
        code: 'PARK',
        name: 'Parking',
        postingRule: 'once',
        chargeType: 'parking',
        currencyCode: 'EUR',
        unitPrice: '15.00',
        quantity: 1,
        lineTotal: '15.00',
        taxTotal: '2.00',
        lineItems: [{ date: '2026-10-01', amount: '15.00', tax: '2.00' }],
      }],
      servicesTotal: '15.00',
      servicesTaxTotal: '2.00',
      grandTotal: '277.00',
    };
    harness.bookingEngine.quote.mockResolvedValue(acceptedQuote);
    harness.ancillary.attachToReservation.mockResolvedValue({
      id: '44444444-0000-4000-a000-000000000001',
      reservationId: RESERVATION_ID,
      serviceId,
      serviceName: 'Parking',
      sourceChannel: 'booking_engine',
      quantity: 1,
      unitPrice: '15.00',
      postingRule: 'once',
    });
    harness.ancillary.ensurePackageComponents.mockResolvedValue([{
      id: '44444444-0000-4000-a000-000000000002',
      reservationId: RESERVATION_ID,
      serviceId: packageServiceId,
      serviceName: 'Included transfer',
      sourceChannel: 'package',
      quantity: 1,
      unitPrice: '0.00',
      postingRule: 'once',
    }]);

    await call(harness.service, 'accept', [
      REQUEST_ID,
      PROPERTY_ID,
      { priceSource: 'current', previewToken: previewToken(acceptedQuote) },
      actor,
    ]);

    const serviceEvents = harness.state.consequences
      .filter((row) => String(row['kind']).startsWith('service:'))
      .map((row) => (row['payload'] as any).data);
    expect(serviceEvents).toEqual([
      {
        reservationId: RESERVATION_ID,
        serviceId,
        serviceName: 'Parking',
        sourceChannel: 'booking_engine',
        quantity: 1,
        unitPrice: '15.00',
        postingRule: 'once',
      },
      {
        reservationId: RESERVATION_ID,
        serviceId: packageServiceId,
        serviceName: 'Included transfer',
        sourceChannel: 'package',
        quantity: 1,
        unitPrice: '0.00',
        postingRule: 'once',
      },
    ]);
  });

  it('treats cross-property acceptance as not found', async () => {
    const harness = makeHarness([pendingRequest({ propertyId: OTHER_PROPERTY_ID })]);

    await expect(call(harness.service, 'accept', [
      REQUEST_ID,
      PROPERTY_ID,
      { priceSource: 'submitted', previewToken: previewToken() },
      actor,
    ])).rejects.toBeInstanceOf(NotFoundException);
    expect(harness.state.reservations).toHaveLength(0);
  });
});

describe('BookingRequestService denial', () => {
  it('blocks denial while captured money remains unresolved and preserves all rows', async () => {
    const harness = makeHarness();
    harness.state.payments.push({
      id: PAYMENT_ID,
      propertyId: PROPERTY_ID,
      bookingRequestId: REQUEST_ID,
      folioId: null,
      originalPaymentId: null,
      status: 'captured',
      amount: '100.00',
    });

    await expect(call(harness.service, 'deny', [
      REQUEST_ID,
      PROPERTY_ID,
      { reason: 'Unable to accommodate' },
      actor,
    ])).rejects.toThrow(/unresolved money/i);
    expect(harness.state.requests).toHaveLength(1);
    expect(harness.state.requests[0]?.status).toBe('pending');
    expect(harness.state.payments).toHaveLength(1);
  });

  it('blocks denial while a request payment attempt is pending', async () => {
    const harness = makeHarness();
    harness.state.payments.push({
      id: PAYMENT_ID,
      propertyId: PROPERTY_ID,
      bookingRequestId: REQUEST_ID,
      folioId: null,
      originalPaymentId: null,
      status: 'pending',
      amount: '100.00',
    });

    await expect(call(harness.service, 'deny', [
      REQUEST_ID,
      PROPERTY_ID,
      { reason: 'Unable to accommodate' },
      actor,
    ])).rejects.toThrow(/pending payment/i);
    expect(harness.state.requests[0]?.status).toBe('pending');
  });

  it('blocks denial while a refund capacity claim is pending', async () => {
    const harness = makeHarness();
    harness.state.payments.push({
      id: PAYMENT_ID,
      propertyId: PROPERTY_ID,
      bookingRequestId: REQUEST_ID,
      folioId: null,
      originalPaymentId: null,
      status: 'captured',
      amount: '100.00',
    });
    harness.state.resolutions.push({
      id: '66666666-0000-4000-a000-000000000002',
      propertyId: PROPERTY_ID,
      bookingRequestId: REQUEST_ID,
      paymentId: PAYMENT_ID,
      type: 'refund',
      status: 'pending',
      amount: '100.00',
      reason: 'Gateway refund pending',
    });

    await expect(call(harness.service, 'deny', [
      REQUEST_ID,
      PROPERTY_ID,
      { reason: 'Unable to accommodate' },
      actor,
    ])).rejects.toThrow(/pending refund|pending payment resolution/i);
    expect(harness.state.requests[0]?.status).toBe('pending');
  });

  it('treats canonical child returns and retained remainder as resolved without double subtraction', async () => {
    const childId = '22222222-0000-4000-a000-000000000099';
    const harness = makeHarness();
    harness.state.payments.push({
      id: PAYMENT_ID,
      propertyId: PROPERTY_ID,
      bookingRequestId: REQUEST_ID,
      folioId: null,
      originalPaymentId: null,
      status: 'captured',
      amount: '100.00',
    }, {
      id: childId,
      propertyId: PROPERTY_ID,
      bookingRequestId: REQUEST_ID,
      folioId: null,
      originalPaymentId: PAYMENT_ID,
      status: 'captured',
      amount: '-40.00',
    });
    harness.state.resolutions.push({
      id: '66666666-0000-4000-a000-000000000011',
      propertyId: PROPERTY_ID,
      bookingRequestId: REQUEST_ID,
      paymentId: PAYMENT_ID,
      movementId: childId,
      type: 'refund',
      status: 'completed',
      amount: '40.00',
      reason: 'Canonical return provenance',
    }, {
      id: '66666666-0000-4000-a000-000000000012',
      propertyId: PROPERTY_ID,
      bookingRequestId: REQUEST_ID,
      paymentId: PAYMENT_ID,
      movementId: null,
      type: 'retained',
      status: 'completed',
      amount: '60.00',
      reason: 'Non-refundable supplier cost',
    });

    await expect(call(harness.service, 'deny', [
      REQUEST_ID,
      PROPERTY_ID,
      { reason: 'Unable to accommodate' },
      actor,
    ])).resolves.toMatchObject({ status: 'denied' });
  });

  it('treats a full generic canonical child return as resolved without a resolution row', async () => {
    const harness = makeHarness();
    harness.state.payments.push({
      id: PAYMENT_ID,
      propertyId: PROPERTY_ID,
      bookingRequestId: REQUEST_ID,
      folioId: null,
      originalPaymentId: null,
      status: 'captured',
      amount: '100.00',
    }, {
      id: '22222222-0000-4000-a000-000000000097',
      propertyId: PROPERTY_ID,
      bookingRequestId: REQUEST_ID,
      folioId: null,
      originalPaymentId: PAYMENT_ID,
      status: 'captured',
      amount: '-100.00',
    });

    await expect(call(harness.service, 'deny', [
      REQUEST_ID,
      PROPERTY_ID,
      { reason: 'Unable to accommodate' },
      actor,
    ])).resolves.toMatchObject({ status: 'denied' });
  });

  it('still blocks denial for the unresolved remainder after partial child and retain evidence', async () => {
    const harness = makeHarness();
    harness.state.payments.push({
      id: PAYMENT_ID,
      propertyId: PROPERTY_ID,
      bookingRequestId: REQUEST_ID,
      folioId: null,
      originalPaymentId: null,
      status: 'captured',
      amount: '100.00',
    }, {
      id: '22222222-0000-4000-a000-000000000098',
      propertyId: PROPERTY_ID,
      bookingRequestId: REQUEST_ID,
      folioId: null,
      originalPaymentId: PAYMENT_ID,
      status: 'captured',
      amount: '-40.00',
    });
    harness.state.resolutions.push({
      id: '66666666-0000-4000-a000-000000000013',
      propertyId: PROPERTY_ID,
      bookingRequestId: REQUEST_ID,
      paymentId: PAYMENT_ID,
      movementId: null,
      type: 'retained',
      status: 'completed',
      amount: '50.00',
      reason: 'Partial supplier cost',
    });

    await expect(call(harness.service, 'deny', [
      REQUEST_ID,
      PROPERTY_ID,
      { reason: 'Unable to accommodate' },
      actor,
    ])).rejects.toThrow(/10\.00.*unresolved|unresolved money/i);
  });

  it('denies after money is resolved, records actor, and delivers consequences after commit', async () => {
    const harness = makeHarness();
    harness.state.payments.push({
      id: PAYMENT_ID,
      propertyId: PROPERTY_ID,
      bookingRequestId: REQUEST_ID,
      folioId: null,
      originalPaymentId: null,
      status: 'captured',
      amount: '100.00',
    });
    harness.state.resolutions.push({
      id: '66666666-0000-4000-a000-000000000001',
      propertyId: PROPERTY_ID,
      bookingRequestId: REQUEST_ID,
      paymentId: PAYMENT_ID,
      type: 'retained',
      amount: '100.00',
      reason: 'Non-refundable supplier cost',
    });

    const result = await call(harness.service, 'deny', [
      REQUEST_ID,
      PROPERTY_ID,
      { reason: 'Unable to accommodate' },
      actor,
    ]);

    expect(result).toEqual({
      requestId: REQUEST_ID,
      status: 'denied',
      denialReason: 'Unable to accommodate',
      decidedAt: expect.any(Date),
    });
    expect(harness.state.requests).toHaveLength(1);
    expect(harness.state.payments).toHaveLength(1);
    expect(harness.state.resolutions).toHaveLength(1);
    expect(harness.state.audits).toContainEqual(expect.objectContaining({
      userId: actor.userId,
      userEmail: actor.userEmail,
      ipAddress: actor.ipAddress,
    }));
    expect(harness.dispatchTransactionStates.length).toBeGreaterThan(0);
    expect(harness.dispatchTransactionStates.every((active) => !active)).toBe(true);
    expect(harness.mailer.queue).toHaveBeenCalledWith(expect.objectContaining({
      logicalKey: 'decision:denied',
      kind: 'denied',
      recipient: 'ada@example.com',
    }), expect.anything());
    expect(harness.emailQueueTransactionStates).toEqual([true]);
    expect(harness.emailDeliveryTransactionStates).toEqual([false]);
  });

  it('keeps a denied decision committed when post-commit email delivery fails', async () => {
    const harness = makeHarness();
    harness.mailer.deliverForRequestBestEffort.mockRejectedValueOnce(
      new Error('transport unavailable'),
    );

    await expect(call(harness.service, 'deny', [
      REQUEST_ID,
      PROPERTY_ID,
      { reason: 'Unable to accommodate' },
      actor,
    ])).resolves.toMatchObject({ status: 'denied' });
    expect(harness.state.requests[0]?.status).toBe('denied');
  });

  it('replays a denied decision and retries its pending consequence idempotently', async () => {
    const harness = makeHarness();
    harness.webhook.dispatchPersisted.mockRejectedValueOnce(
      new Error('process stopped after commit'),
    );

    const first = await call(harness.service, 'deny', [
      REQUEST_ID,
      PROPERTY_ID,
      { reason: 'Unable to accommodate' },
      actor,
    ]);
    expect(harness.state.requests[0]?.status).toBe('denied');
    expect(harness.state.consequences[0]).toMatchObject({ status: 'pending' });

    const replay = await call(harness.service, 'deny', [
      REQUEST_ID,
      PROPERTY_ID,
      { reason: 'Different replay text is ignored' },
      actor,
    ]);

    expect(replay).toEqual(first);
    expect(harness.state.consequences[0]).toMatchObject({ status: 'completed' });
    expect(harness.state.requests).toHaveLength(1);
  });

  it('treats cross-property denial as not found', async () => {
    const harness = makeHarness([pendingRequest({ propertyId: OTHER_PROPERTY_ID })]);

    await expect(call(harness.service, 'deny', [
      REQUEST_ID,
      PROPERTY_ID,
      { reason: 'Unable to accommodate' },
      actor,
    ])).rejects.toBeInstanceOf(NotFoundException);
    expect(harness.state.requests[0]?.status).toBe('pending');
  });
});

describe('Booking Request durable consequence recovery', () => {
  function seedPendingConsequence(harness: ReturnType<typeof makeHarness>) {
    harness.state.consequences.push({
      id: '77777777-0000-4000-a000-000000000001',
      propertyId: PROPERTY_ID,
      bookingRequestId: REQUEST_ID,
      kind: 'created_event',
      payload: {
        event: 'booking_request.created',
        entityType: 'booking_request',
        entityId: REQUEST_ID,
        propertyId: PROPERTY_ID,
        data: { requestId: REQUEST_ID, status: 'pending' },
        timestamp: '2026-08-24T10:00:00.000Z',
      },
      status: 'pending',
      attempts: 0,
      claimedAt: null,
      createdAt: new Date('2026-08-24T10:00:00.000Z'),
      updatedAt: new Date('2026-08-24T10:00:00.000Z'),
    });
  }

  it('scans and dispatches a consequence left pending by a process crash', async () => {
    const harness = makeHarness();
    seedPendingConsequence(harness);

    const scanned = await (harness.service as any).processPendingConsequences();

    expect(scanned).toBe(1);
    expect(harness.webhook.dispatchPersisted).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'booking_request.created' }),
      '77777777-0000-4000-a000-000000000001',
    );
    expect(harness.state.consequences[0]).toMatchObject({ status: 'completed' });
  });

  it('property-scoped claims allow concurrent scanners to dispatch a logical event once', async () => {
    const harness = makeHarness();
    seedPendingConsequence(harness);

    await Promise.all([
      (harness.service as any).processPendingConsequences(),
      (harness.service as any).processPendingConsequences(),
    ]);

    expect(harness.webhook.dispatchPersisted).toHaveBeenCalledTimes(1);
    expect(harness.webhook.dispatchPersisted).toHaveBeenCalledWith(
      expect.anything(),
      '77777777-0000-4000-a000-000000000001',
    );
  });

  it('recovers a stale processing lease left by a stopped worker', async () => {
    const harness = makeHarness();
    seedPendingConsequence(harness);
    Object.assign(harness.state.consequences[0]!, {
      status: 'processing',
      claimedAt: new Date(Date.now() - 10 * 60 * 1000),
    });

    await (harness.service as any).processPendingConsequences();

    expect(harness.webhook.dispatchPersisted).toHaveBeenCalledTimes(1);
    expect(harness.state.consequences[0]).toMatchObject({
      status: 'completed',
      claimedAt: null,
    });
  });
});

describe('canonical creation transaction seams', () => {
  it('GuestService.create uses the caller transaction', async () => {
    const mainDb = {
      insert: vi.fn(() => {
        throw new Error('main database used');
      }),
    };
    const tx = {
      insert: vi.fn((table: unknown) => {
        expect(table).toBe(guests);
        return {
          values: vi.fn(() => ({
            returning: vi.fn(async () => [{ id: GUEST_ID }]),
          })),
        };
      }),
    };
    const service = new GuestService(mainDb as any);

    const result = await (service.create as any)({
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
    }, tx);

    expect(result).toEqual({ id: GUEST_ID });
    expect(mainDb.insert).not.toHaveBeenCalled();
  });

  it('FolioService.createAutoFolio uses the caller transaction and emits no pre-commit webhook', async () => {
    const mainDb = {
      select: vi.fn(() => {
        throw new Error('main database used');
      }),
      insert: vi.fn(() => {
        throw new Error('main database used');
      }),
    };
    const webhook = { emit: vi.fn() };
    const tx = {
      select: vi.fn(() => {
        let table: unknown;
        const chain: Record<string, unknown> & PromiseLike<unknown> = {
          from: vi.fn((value: unknown) => {
            table = value;
            return chain;
          }),
          where: vi.fn(() => chain),
          for: vi.fn(() => Promise.resolve(
            table === roomTypes ? [{ id: ROOM_TYPE_ID }] : [],
          )),
          then: (resolve, reject) => Promise.resolve(
            table === folios ? [{ maxNumber: null }] : [{ id: 'exists' }],
          ).then(resolve, reject),
        };
        return chain;
      }),
      insert: vi.fn((table: unknown) => {
        expect(table).toBe(folios);
        return {
          values: vi.fn((values: Record<string, unknown>) => ({
            returning: vi.fn(async () => [{ id: FOLIO_ID, ...values }]),
          })),
        };
      }),
    };
    const service = new FolioService(mainDb as any, webhook as any, {} as any);

    const result = await (service.createAutoFolio as any)({
      id: RESERVATION_ID,
      propertyId: PROPERTY_ID,
      bookingId: '33333333-0000-4000-a000-000000000001',
      guestId: GUEST_ID,
      currencyCode: 'EUR',
    }, tx);

    expect(result.id).toBe(FOLIO_ID);
    expect(mainDb.insert).not.toHaveBeenCalled();
    expect(webhook.emit).not.toHaveBeenCalled();
  });

  it('ReservationService.create performs every lookup and insert in the caller transaction', async () => {
    const mainDb = {
      select: vi.fn(() => {
        throw new Error('main database used');
      }),
      transaction: vi.fn(() => {
        throw new Error('nested transaction opened');
      }),
    };
    const tx = {
      select: vi.fn(() => {
        let table: unknown;
        const chain: Record<string, unknown> & PromiseLike<unknown> = {
          from: vi.fn((value: unknown) => {
            table = value;
            return chain;
          }),
          where: vi.fn(() => chain),
          for: vi.fn(() => Promise.resolve(
            table === roomTypes ? [{ id: ROOM_TYPE_ID }] : [],
          )),
          then: (resolve, reject) => Promise.resolve(
            table === guests
              ? [{ id: GUEST_ID, isDnr: false }]
              : [{ id: table === roomTypes ? ROOM_TYPE_ID : RATE_PLAN_ID }],
          ).then(resolve, reject),
        };
        return chain;
      }),
      insert: vi.fn((_table: unknown) => ({
        values: vi.fn((values: Record<string, unknown>) => {
          const row = _table === bookings
            ? { id: '33333333-0000-4000-a000-000000000001', ...values }
            : _table === reservations
              ? { id: RESERVATION_ID, ...values }
              : values;
          return {
            returning: vi.fn(async () => [row]),
            then: (resolve: (value: unknown) => unknown) => Promise.resolve(undefined).then(resolve),
          };
        }),
      })),
    };
    const availability = {
      searchAvailability: vi.fn(async () => [{
        roomTypeId: ROOM_TYPE_ID,
        date: '2026-10-01',
        available: 1,
      }, {
        roomTypeId: ROOM_TYPE_ID,
        date: '2026-10-02',
        available: 1,
      }]),
    };
    const webhook = { emit: vi.fn() };
    const ratePlan = { assertSellable: vi.fn(async () => undefined) };
    const service = new ReservationService(
      mainDb as any,
      availability as any,
      {} as any,
      {} as any,
      {} as any,
      webhook as any,
      {} as any,
      {} as any,
      {} as any,
      ratePlan as any,
    );

    const result = await (service.create as any)({
      propertyId: PROPERTY_ID,
      guestId: GUEST_ID,
      arrivalDate: '2026-10-01',
      departureDate: '2026-10-03',
      roomTypeId: ROOM_TYPE_ID,
      ratePlanId: RATE_PLAN_ID,
      totalAmount: '220.00',
      currencyCode: 'EUR',
      source: 'direct',
    }, {}, tx);

    expect(result.id).toBe(RESERVATION_ID);
    expect(mainDb.transaction).not.toHaveBeenCalled();
    expect(availability.searchAvailability).toHaveBeenCalledWith(
      PROPERTY_ID,
      '2026-10-01',
      '2026-10-03',
      ROOM_TYPE_ID,
      tx,
    );
    expect(ratePlan.assertSellable).toHaveBeenCalledWith(
      PROPERTY_ID,
      RATE_PLAN_ID,
      '2026-10-01',
      '2026-10-03',
      tx,
    );
    expect(tx.insert).toHaveBeenCalledWith(reservationGuests);
    expect(webhook.emit).not.toHaveBeenCalled();
  });

  it('AncillaryService attach and package ensure use the caller transaction without emitting', async () => {
    const mainDb = {
      select: vi.fn(() => {
        throw new Error('main database used');
      }),
      insert: vi.fn(() => {
        throw new Error('main database used');
      }),
    };
    const inserted: Array<Record<string, unknown>> = [];
    const tx = {
      select: vi.fn((selection?: Record<string, unknown>) => {
        let table: unknown;
        const chain: Record<string, unknown> & PromiseLike<unknown> = {
          from: vi.fn((value: unknown) => {
            table = value;
            return chain;
          }),
          where: vi.fn(() => chain),
          then: (resolve, reject) => Promise.resolve(
            table === reservations
              ? [{ id: RESERVATION_ID, propertyId: PROPERTY_ID, ratePlanId: RATE_PLAN_ID }]
              : table === services
                ? [{
                    id: '77777777-0000-4000-a000-000000000001',
                    propertyId: PROPERTY_ID,
                    isActive: true,
                    price: '25.00',
                    currencyCode: 'EUR',
                    postingRule: 'once',
                    chargeType: 'fee',
                    name: 'Breakfast',
                  }]
                : table === ratePlanComponents
                  ? [{
                      serviceId: '77777777-0000-4000-a000-000000000001',
                      quantity: 1,
                      includedInRate: true,
                      amountOverride: null,
                    }]
                  : table === reservationServices && selection
                    ? []
                    : [],
          ).then(resolve, reject),
        };
        return chain;
      }),
      insert: vi.fn((_table: unknown) => ({
        values: vi.fn((values: Record<string, unknown>) => ({
          returning: vi.fn(async () => {
            const row = {
              id: `88888888-0000-4000-a000-${String(inserted.length + 1).padStart(12, '0')}`,
              ...values,
            };
            inserted.push(row);
            return [row];
          }),
        })),
      })),
    };
    const webhook = { emit: vi.fn() };
    const service = new AncillaryService(mainDb as any, {} as any, webhook as any);

    const selected = await (service.attachToReservation as any)(RESERVATION_ID, {
      propertyId: PROPERTY_ID,
      serviceId: '77777777-0000-4000-a000-000000000001',
      sourceChannel: 'booking_engine',
    }, tx);
    const packaged = await (service.ensurePackageComponents as any)(
      RESERVATION_ID,
      PROPERTY_ID,
      tx,
    );

    expect(selected.reservationId).toBe(RESERVATION_ID);
    expect(packaged).toHaveLength(1);
    expect(mainDb.select).not.toHaveBeenCalled();
    expect(mainDb.insert).not.toHaveBeenCalled();
    expect(webhook.emit).not.toHaveBeenCalled();
  });
});
