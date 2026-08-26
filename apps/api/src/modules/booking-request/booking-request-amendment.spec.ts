import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ValidationPipe,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  auditLogs,
  bookingRequestConsequences,
  bookingRequests,
  bookingRequestStayAmendments,
  properties,
  reservationServices,
  reservations,
} from '@telivityhaip/database';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Reflector } from '@nestjs/core';
import type { AcceptedPricingSnapshot } from '@telivityhaip/database';
import { PERMISSIONS_KEY } from '../auth/permissions.decorator';
import { BookingRequestController } from './booking-request.controller';
import {
  amendmentPreviewFingerprint,
  BookingRequestService,
} from './booking-request.service';
import {
  AmendBookingRequestStayDto,
  PreviewBookingRequestStayAmendmentDto,
} from './dto/amend-booking-request-stay.dto';

const PROPERTY = 'aaaaaaaa-0000-4000-a000-000000000001';
const OTHER_PROPERTY = 'aaaaaaaa-0000-4000-a000-000000000002';
const REQUEST = 'bbbbbbbb-0000-4000-a000-000000000001';
const RESERVATION = 'cccccccc-0000-4000-a000-000000000001';
const FOLIO = 'dddddddd-0000-4000-a000-000000000001';
const ROOM_TYPE = 'eeeeeeee-0000-4000-a000-000000000001';
const RATE_PLAN = 'ffffffff-0000-4000-a000-000000000001';

const acceptedPricing: AcceptedPricingSnapshot = {
  version: 1,
  source: 'current',
  currencyCode: 'EUR',
  grandTotal: '220.00',
  roomTotal: '200.00',
  taxTotal: '20.00',
  nights: [
    { date: '2026-10-01', roomAmount: '100.00', taxAmount: '10.00' },
    { date: '2026-10-02', roomAmount: '100.00', taxAmount: '10.00' },
  ],
  services: [],
  servicesTotal: '0.00',
  servicesTaxTotal: '0.00',
  customReason: null,
  adjustment: null,
};

function currentQuote(rate = '120.00', tax = '12.00') {
  const dates = ['2026-10-01', '2026-10-02', '2026-10-03'];
  return {
    propertyId: PROPERTY,
    roomTypeId: ROOM_TYPE,
    ratePlanId: RATE_PLAN,
    checkIn: '2026-10-01',
    checkOut: '2026-10-04',
    nights: 3,
    currencyCode: 'EUR',
    lineItems: dates.map((date) => ({ date, rate, tax })),
    roomTotal: String((Number(rate) * 3).toFixed(2)),
    taxTotal: String((Number(tax) * 3).toFixed(2)),
    services: [],
    servicesTotal: '0.00',
    servicesTaxTotal: '0.00',
    grandTotal: String(((Number(rate) + Number(tax)) * 3).toFixed(2)),
  };
}

function acceptedRequest(status: 'pending' | 'accepted' | 'denied' = 'accepted') {
  return {
    id: REQUEST,
    propertyId: PROPERTY,
    submissionIdempotencyKey: 'original-request',
    submissionFingerprint: 'original-fingerprint',
    status,
    arrivalDate: '2026-10-01',
    departureDate: '2026-10-03',
    roomTypeId: ROOM_TYPE,
    ratePlanId: RATE_PLAN,
    adults: 2,
    children: 0,
    guestFirstName: 'Ada',
    guestLastName: 'Lovelace',
    guestEmail: 'ada@example.com',
    guestPhone: null,
    specialRequests: null,
    serviceIds: [],
    formSnapshot: [],
    applicationAnswers: {},
    submittedQuoteSnapshot: {
      currencyCode: 'EUR',
      grandTotal: '220.00',
    },
    currentQuoteSnapshot: {
      currencyCode: 'EUR',
      grandTotal: '220.00',
    },
    currencyCode: 'EUR',
    setupIntentId: null,
    stripeCustomerId: null,
    stripePaymentMethodId: null,
    cardLastFour: null,
    cardBrand: null,
    consentText: null,
    consentVersion: null,
    consentedAt: null,
    acceptedPriceSource: 'current',
    acceptedTotal: '220.00',
    customPriceReason: null,
    acceptedReservationId: status === 'accepted' ? RESERVATION : null,
    acceptedFolioId: status === 'accepted' ? FOLIO : null,
    decidedBy: 'staff-original',
    decidedAt: new Date('2026-08-24T10:00:00.000Z'),
    denialReason: null,
    createdAt: new Date('2026-08-24T09:00:00.000Z'),
    updatedAt: new Date('2026-08-24T10:00:00.000Z'),
  };
}

function linkedReservation() {
  return {
    id: RESERVATION,
    propertyId: PROPERTY,
    bookingId: 'booking-1',
    guestId: 'guest-1',
    arrivalDate: '2026-10-01',
    departureDate: '2026-10-03',
    nights: 2,
    roomTypeId: ROOM_TYPE,
    roomId: null,
    status: 'confirmed',
    ratePlanId: RATE_PLAN,
    totalAmount: '220.00',
    currencyCode: 'EUR',
    acceptedPricingSnapshot: structuredClone(acceptedPricing),
    adults: 2,
    children: 0,
    updatedAt: new Date('2026-08-24T10:05:00.000Z'),
  };
}

type HarnessState = {
  properties: Array<Record<string, any>>;
  requests: Array<Record<string, any>>;
  reservations: Array<Record<string, any>>;
  amendments: Array<Record<string, any>>;
  audits: Array<Record<string, any>>;
  consequences: Array<Record<string, any>>;
  reservationServices: Array<Record<string, any>>;
};

function makeDatabase(state: HarnessState, lockOrder: string[]) {
  const rowsFor = (table: unknown) => {
    if (table === properties) return state.properties;
    if (table === bookingRequests) return state.requests;
    if (table === reservations) return state.reservations;
    if (table === bookingRequestStayAmendments) return state.amendments;
    if (table === auditLogs) return state.audits;
    if (table === bookingRequestConsequences) return state.consequences;
    if (table === reservationServices) return state.reservationServices;
    return [];
  };
  let transactionActive = false;

  const selectBuilder = (selection?: Record<string, unknown>) => {
    let table: unknown;
    let limit: number | undefined;
    const resolveRows = () => {
      const rows = structuredClone(rowsFor(table));
      if (selection && Object.keys(selection).length === 1 && 'count' in selection) {
        return [{ count: rows.length }];
      }
      return limit == null ? rows : rows.slice(0, limit);
    };
    const chain: any = {
      from: vi.fn((value: unknown) => { table = value; return chain; }),
      where: vi.fn(() => chain),
      orderBy: vi.fn(() => chain),
      limit: vi.fn((value: number) => { limit = value; return chain; }),
      for: vi.fn(async () => {
        if (table === properties) lockOrder.push('property');
        else if (table === bookingRequests) lockOrder.push('request');
        else if (
          table === reservations
          && selection
          && Object.keys(selection).length === 1
          && 'id' in selection
        ) lockOrder.push('pricing-lock');
        else if (table === reservations) lockOrder.push('reservation');
        return resolveRows();
      }),
      then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) =>
        Promise.resolve(resolveRows()).then(resolve, reject),
    };
    return chain;
  };

  const db: any = {
    execute: vi.fn(async () => undefined),
    select: vi.fn((selection?: Record<string, unknown>) => selectBuilder(selection)),
    insert: vi.fn((table: unknown) => ({
      values: vi.fn((values: Record<string, any>) => {
        let row: Record<string, any> | undefined;
        const execute = () => {
          if (row) return row;
          row = {
            id: values.id ?? `${table === bookingRequestStayAmendments ? 'amendment' : 'row'}-${rowsFor(table).length + 1}`,
            ...structuredClone(values),
          };
          rowsFor(table).push(row);
          return row;
        };
        const builder: any = {
          returning: vi.fn(async () => [execute()]),
          then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) =>
            Promise.resolve().then(() => execute()).then(() => undefined).then(resolve, reject),
        };
        return builder;
      }),
    })),
    update: vi.fn((table: unknown) => ({
      set: vi.fn((changes: Record<string, any>) => ({
        where: vi.fn(() => {
          const apply = () => {
            for (const row of rowsFor(table)) Object.assign(row, structuredClone(changes));
            return structuredClone(rowsFor(table));
          };
          const builder: any = {
            returning: vi.fn(async () => apply()),
            then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) =>
              Promise.resolve().then(() => apply()).then(() => undefined).then(resolve, reject),
          };
          return builder;
        }),
      })),
    })),
    delete: vi.fn(() => { throw new Error('Stay amendments never delete business records'); }),
  };
  db.transaction = vi.fn(async (callback: (tx: any) => Promise<unknown>) => {
    const snapshot = structuredClone(state);
    transactionActive = true;
    try {
      return await callback(db);
    } catch (error) {
      Object.assign(state, snapshot);
      throw error;
    } finally {
      transactionActive = false;
    }
  });
  return { db, isTransactionActive: () => transactionActive };
}

function makeHarness(status: 'pending' | 'accepted' | 'denied' = 'accepted') {
  const state: HarnessState = {
    properties: [{ id: PROPERTY, currencyCode: 'EUR' }],
    requests: [acceptedRequest(status)],
    reservations: status === 'accepted' ? [linkedReservation()] : [],
    amendments: [],
    audits: [],
    consequences: [],
    reservationServices: [],
  };
  const lockOrder: string[] = [];
  const database = makeDatabase(state, lockOrder);
  let quote = currentQuote();
  const quoteTransactionStates: boolean[] = [];
  const bookingEngine = {
    quote: vi.fn(async () => {
      quoteTransactionStates.push(database.isTransactionActive());
      return structuredClone(quote);
    }),
  };
  const reservation = {
    lockInventory: vi.fn(async () => { lockOrder.push('inventory'); }),
    modifyAcceptedStay: vi.fn(async (
      locked: Record<string, any>,
      propertyId: string,
      dto: Record<string, string>,
      pricing: AcceptedPricingSnapshot,
    ) => {
      const row = state.reservations.find((candidate) =>
        candidate.id === locked.id && candidate.propertyId === propertyId)!;
      const previous = structuredClone(row);
      Object.assign(row, {
        arrivalDate: dto.arrivalDate,
        departureDate: dto.departureDate,
        nights: pricing.nights.length,
        totalAmount: pricing.grandTotal,
        acceptedPricingSnapshot: structuredClone(pricing),
        updatedAt: new Date('2026-08-25T12:00:00.000Z'),
      });
      return {
        reservation: structuredClone(row),
        previousArrivalDate: previous.arrivalDate,
        previousDepartureDate: previous.departureDate,
        previousTotalAmount: previous.totalAmount,
        newTotalAmount: row.totalAmount,
      };
    }),
  };
  const folio = {
    reconcileAcceptedStayAmendment: vi.fn(async () => ({
      reversedChargeIds: [],
      adjustmentAmount: '44.00',
    })),
  };
  const dispatchTransactionStates: boolean[] = [];
  const webhook = {
    dispatchPersisted: vi.fn(async () => {
      dispatchTransactionStates.push(database.isTransactionActive());
    }),
    emit: vi.fn(),
  };
  const mailer = {
    queue: vi.fn(() => { throw new Error('Stay amendments do not send email'); }),
    deliverForRequestBestEffort: vi.fn(() => { throw new Error('Stay amendments do not send email'); }),
  };
  const service = new BookingRequestService(
    database.db,
    {} as any,
    bookingEngine as any,
    {} as any,
    {} as any,
    {} as any,
    webhook as any,
    {} as any,
    reservation as any,
    folio as any,
    {} as any,
    mailer as any,
  );
  return {
    service,
    state,
    lockOrder,
    bookingEngine,
    reservation,
    folio,
    webhook,
    mailer,
    quoteTransactionStates,
    dispatchTransactionStates,
    setQuote(next: ReturnType<typeof currentQuote>) { quote = next; },
  };
}

const dates = {
  arrivalDate: '2026-10-01',
  departureDate: '2026-10-04',
};

describe('Booking Request stay amendment DTOs', () => {
  it('requires canonical dates, a fingerprint, a durable key, and custom reason', async () => {
    const invalid = plainToInstance(AmendBookingRequestStayDto, {
      arrivalDate: '2026-10-01T10:00:00.000Z',
      departureDate: '2026-10-01',
      priceSource: 'custom',
      previewToken: 'not-a-token',
      idempotencyKey: '',
      customTotal: '100.00',
    });
    const errors = await validate(invalid);
    expect(errors.map((error) => error.property)).toEqual(expect.arrayContaining([
      'arrivalDate', 'previewToken', 'idempotencyKey',
    ]));

    const preview = plainToInstance(PreviewBookingRequestStayAmendmentDto, {
      propertyId: PROPERTY,
      arrivalDate: '2026-10-01',
      departureDate: 'invalid',
    });
    expect((await validate(preview)).map((error) => error.property)).toContain('departureDate');
  });

  it('accepts the real preview query through the global whitelist pipe and controller', async () => {
    const stayAmendmentPreview = vi.fn().mockResolvedValue({ previewToken: 'token' });
    const controller = new BookingRequestController(
      { stayAmendmentPreview } as any,
      {} as any,
      {} as any,
    );
    const query = await new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }).transform({ propertyId: PROPERTY, ...dates }, {
      type: 'query',
      metatype: PreviewBookingRequestStayAmendmentDto,
    });

    await controller.stayAmendmentPreview(REQUEST, query.propertyId, query);

    expect(stayAmendmentPreview).toHaveBeenCalledWith(
      REQUEST,
      PROPERTY,
      expect.objectContaining({ propertyId: PROPERTY, ...dates }),
    );
  });
});

describe('BookingRequestService stay amendment preview', () => {
  it('exposes the linked operational stay without mutating the original requested deal', async () => {
    const detail = await makeHarness().service.findById(REQUEST, PROPERTY);

    expect(detail).toMatchObject({
      arrivalDate: '2026-10-01',
      departureDate: '2026-10-03',
      acceptedTotal: '220.00',
      operationalReservation: {
        id: RESERVATION,
        arrivalDate: '2026-10-01',
        departureDate: '2026-10-03',
        totalAmount: '220.00',
        currencyCode: 'EUR',
      },
    });
  });

  it('returns prior and authoritative current totals with a reservation-state fingerprint', async () => {
    const harness = makeHarness();
    const preview = await harness.service.stayAmendmentPreview(
      REQUEST,
      PROPERTY,
      dates,
    );

    expect(preview).toEqual(expect.objectContaining({
      requestId: REQUEST,
      reservationId: RESERVATION,
      previousArrivalDate: '2026-10-01',
      previousDepartureDate: '2026-10-03',
      previousTotal: '220.00',
      arrivalDate: '2026-10-01',
      departureDate: '2026-10-04',
      priorTotal: '330.00',
      currentTotal: '396.00',
      currencyCode: 'EUR',
      previewVersion: 1,
      previewToken: expect.stringMatching(/^v1:[a-f0-9]{64}$/),
    }));
    expect(harness.bookingEngine.quote).toHaveBeenCalledWith(
      PROPERTY,
      expect.objectContaining({ checkIn: dates.arrivalDate, checkOut: dates.departureDate }),
      undefined,
      { excludeReservationId: RESERVATION },
    );
  });

  it('excludes a cancelled accepted service from prior/current operational pricing', async () => {
    const harness = makeHarness();
    const serviceLine = {
      serviceId: 'parking', code: 'PARKING', name: 'Parking', postingRule: 'once',
      chargeType: 'parking', currencyCode: 'EUR', unitPrice: '20.00', quantity: 1,
      lineTotal: '20.00', taxTotal: '2.00',
      lineItems: [{ date: '2026-10-01', amount: '20.00', taxAmount: '2.00' }],
    };
    Object.assign(harness.state.reservations[0]!, {
      totalAmount: '242.00',
      acceptedPricingSnapshot: {
        ...structuredClone(acceptedPricing), services: [serviceLine],
        servicesTotal: '20.00', servicesTaxTotal: '2.00', grandTotal: '242.00',
      },
    });
    harness.state.requests[0]!.serviceIds = ['parking'];
    harness.state.reservationServices.push({
      id: 'rs-parking', propertyId: PROPERTY, reservationId: RESERVATION,
      serviceId: 'parking', status: 'cancelled', sourceChannel: 'booking_engine',
      createdAt: new Date('2026-08-24T10:05:00.000Z'),
    }, {
      id: 'rs-parking-frontdesk', propertyId: PROPERTY, reservationId: RESERVATION,
      serviceId: 'parking', status: 'confirmed', sourceChannel: 'front_desk',
      createdAt: new Date('2026-08-25T10:05:00.000Z'),
    });

    const preview = await harness.service.stayAmendmentPreview(REQUEST, PROPERTY, dates);

    expect(preview).toMatchObject({ previousTotal: '220.00', priorTotal: '330.00' });
    expect(harness.bookingEngine.quote).toHaveBeenLastCalledWith(
      PROPERTY,
      expect.objectContaining({ serviceIds: [] }),
      undefined,
      { excludeReservationId: RESERVATION },
    );
  });

  it('rejects pending/denied requests, wrong property scope, and unavailable complete windows', async () => {
    await expect(makeHarness('pending').service.stayAmendmentPreview(REQUEST, PROPERTY, dates))
      .rejects.toThrow(ConflictException);
    await expect(makeHarness('denied').service.stayAmendmentPreview(REQUEST, PROPERTY, dates))
      .rejects.toThrow(ConflictException);
    await expect(makeHarness().service.stayAmendmentPreview(REQUEST, OTHER_PROPERTY, dates))
      .rejects.toThrow(NotFoundException);

    const unavailable = makeHarness();
    unavailable.bookingEngine.quote.mockRejectedValueOnce(
      new BadRequestException('No availability for room type on 2026-10-03'),
    );
    await expect(unavailable.service.stayAmendmentPreview(REQUEST, PROPERTY, dates))
      .rejects.toThrow(ConflictException);
  });

  it('shows only request-linked stay amendments in the request audit timeline', async () => {
    const harness = makeHarness();
    const occurredAt = new Date('2026-08-25T10:00:00.000Z');
    harness.state.audits.push(
      {
        id: 'request-amendment-audit',
        propertyId: PROPERTY,
        bookingRequestId: REQUEST,
        action: 'update',
        entityType: 'reservation',
        entityId: RESERVATION,
        userId: 'staff-1',
        userEmail: 'staff@example.com',
        previousValue: { arrivalDate: '2026-10-01' },
        newValue: { amendmentId: 'amendment-1', arrivalDate: '2026-10-02' },
        description: 'Accepted Booking Request stay amended',
        occurredAt,
        occurredAtMicros: '1787652000000000',
      },
      {
        id: 'generic-reservation-audit',
        propertyId: PROPERTY,
        bookingRequestId: null,
        action: 'update',
        entityType: 'reservation',
        entityId: RESERVATION,
        userId: 'staff-2',
        userEmail: 'other@example.com',
        previousValue: { status: 'confirmed' },
        newValue: { status: 'checked_in' },
        description: 'Reservation checked in',
        occurredAt,
        occurredAtMicros: '1787652000000001',
      },
    );

    const history = await harness.service.auditHistory(REQUEST, PROPERTY);

    expect(history.data.map((row) => row.id)).toEqual(['request-amendment-audit']);
    expect(history.data[0]).toMatchObject({ summary: 'stay.amended' });
  });
});

describe('Booking Request stay amendment HTTP contract', () => {
  it('exposes read preview and write commit endpoints with runtime DTO metadata', () => {
    const reflector = new Reflector();
    expect(reflector.get(
      PERMISSIONS_KEY,
      BookingRequestController.prototype.stayAmendmentPreview,
    )).toEqual(['reservations.read']);
    expect(reflector.get(
      PERMISSIONS_KEY,
      BookingRequestController.prototype.amendStay,
    )).toEqual(['reservations.write']);
    expect(Reflect.getMetadata(
      'design:paramtypes',
      BookingRequestController.prototype,
      'stayAmendmentPreview',
    )).toContain(PreviewBookingRequestStayAmendmentDto);
    expect(Reflect.getMetadata(
      'design:paramtypes',
      BookingRequestController.prototype,
      'amendStay',
    )).toContain(AmendBookingRequestStayDto);
  });
});

describe('BookingRequestService accepted stay amendment commit', () => {
  beforeEach(() => vi.clearAllMocks());

  it('commits without a cancelled accepted service so total and posting snapshot stay aligned', async () => {
    const harness = makeHarness();
    const serviceLine = {
      serviceId: 'parking', code: 'PARKING', name: 'Parking', postingRule: 'once',
      chargeType: 'parking', currencyCode: 'EUR', unitPrice: '20.00', quantity: 1,
      lineTotal: '20.00', taxTotal: '2.00',
      lineItems: [{ date: '2026-10-01', amount: '20.00', taxAmount: '2.00' }],
    };
    Object.assign(harness.state.reservations[0]!, {
      totalAmount: '242.00',
      acceptedPricingSnapshot: {
        ...structuredClone(acceptedPricing), services: [serviceLine],
        servicesTotal: '20.00', servicesTaxTotal: '2.00', grandTotal: '242.00',
      },
    });
    harness.state.requests[0]!.serviceIds = ['parking'];
    harness.state.reservationServices.push({
      id: 'rs-parking', propertyId: PROPERTY, reservationId: RESERVATION,
      serviceId: 'parking', status: 'cancelled',
    });
    const preview = await harness.service.stayAmendmentPreview(REQUEST, PROPERTY, dates);

    await harness.service.amendStay(REQUEST, PROPERTY, {
      ...dates,
      priceSource: 'prior',
      previewToken: preview.previewToken,
      idempotencyKey: 'cancelled-service-amendment',
    });

    expect(harness.state.reservations[0]).toMatchObject({
      totalAmount: '330.00',
      acceptedPricingSnapshot: expect.objectContaining({
        grandTotal: '330.00', services: [], servicesTotal: '0.00', servicesTaxTotal: '0.00',
      }),
    });
    expect(harness.folio.reconcileAcceptedStayAmendment).toHaveBeenCalledWith(
      expect.objectContaining({
        previousPricing: expect.objectContaining({ grandTotal: '242.00', services: [serviceLine] }),
        newPricing: expect.objectContaining({ grandTotal: '330.00', services: [] }),
      }),
    );
  });

  it('takes the pricing mutex before row locks, updates operational state, and emits one durable event', async () => {
    const harness = makeHarness();
    const requestBefore = structuredClone(harness.state.requests[0]);
    const preview = await harness.service.stayAmendmentPreview(REQUEST, PROPERTY, dates);
    harness.lockOrder.splice(0);

    const result = await harness.service.amendStay(
      REQUEST,
      PROPERTY,
      {
        ...dates,
        priceSource: 'current',
        previewToken: preview.previewToken,
        idempotencyKey: 'front-desk-amendment-1',
      },
      { userId: 'staff-1', userEmail: 'staff@example.com' },
    );

    expect(harness.lockOrder).toEqual([
      'pricing-lock',
      'property',
      'request',
      'reservation',
      'inventory',
    ]);
    expect(harness.quoteTransactionStates.at(-1)).toBe(true);
    expect(harness.bookingEngine.quote).toHaveBeenLastCalledWith(
      PROPERTY,
      expect.objectContaining({ checkIn: '2026-10-01', checkOut: '2026-10-04' }),
      expect.anything(),
      { lockForUpdate: true, excludeReservationId: RESERVATION },
    );
    expect(harness.state.requests[0]).toEqual(requestBefore);
    expect(harness.state.reservations[0]).toMatchObject({
      arrivalDate: '2026-10-01',
      departureDate: '2026-10-04',
      totalAmount: '396.00',
      acceptedPricingSnapshot: expect.objectContaining({ source: 'current', grandTotal: '396.00' }),
    });
    expect(harness.folio.reconcileAcceptedStayAmendment).toHaveBeenCalledWith(
      expect.objectContaining({
        propertyId: PROPERTY,
        folioId: FOLIO,
        reservationId: RESERVATION,
        postedBy: 'staff-1',
        previousPricing: acceptedPricing,
        newPricing: expect.objectContaining({ grandTotal: '396.00' }),
      }),
    );
    expect(harness.state.amendments).toHaveLength(1);
    expect(harness.state.amendments[0]).toMatchObject({
      propertyId: PROPERTY,
      bookingRequestId: REQUEST,
      reservationId: RESERVATION,
      idempotencyKey: 'front-desk-amendment-1',
      previousTotalAmount: '220.00',
      newTotalAmount: '396.00',
      priceSource: 'current',
    });
    expect(harness.state.audits).toContainEqual(expect.objectContaining({
      bookingRequestId: REQUEST,
      entityType: 'reservation',
      entityId: RESERVATION,
      userId: 'staff-1',
      previousValue: expect.objectContaining({ totalAmount: '220.00' }),
      newValue: expect.objectContaining({
        previousArrivalDate: '2026-10-01',
        previousDepartureDate: '2026-10-03',
        previousTotalAmount: '220.00',
        previousPriceSource: 'current',
        arrivalDate: '2026-10-01',
        departureDate: '2026-10-04',
        totalAmount: '396.00',
        priceSource: 'current',
        reason: null,
      }),
    }));
    expect(harness.state.audits.filter((row) =>
      row.bookingRequestId === REQUEST && row.entityType === 'reservation')).toHaveLength(1);
    expect(harness.state.consequences).toHaveLength(1);
    expect(harness.state.consequences[0]).toMatchObject({
      kind: expect.stringMatching(/^amend:/),
      status: 'completed',
      payload: expect.objectContaining({
        event: 'reservation.modified',
        entityId: RESERVATION,
        data: expect.objectContaining({
          previousArrivalDate: '2026-10-01',
          previousDepartureDate: '2026-10-03',
          totalAmount: '396.00',
        }),
      }),
    });
    expect(harness.webhook.dispatchPersisted).toHaveBeenCalledTimes(1);
    expect(harness.state.audits.filter((row) =>
      row.bookingRequestId === REQUEST && row.entityType === 'reservation')).toHaveLength(1);
    expect(harness.dispatchTransactionStates).toEqual([false]);
    expect(harness.mailer.queue).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      amendmentId: harness.state.amendments[0]!.id,
      requestId: REQUEST,
      reservationId: RESERVATION,
      previousTotalAmount: '220.00',
      newTotalAmount: '396.00',
    });
  });

  it('replays the same durable operation without duplicating folio, audit, or event effects', async () => {
    const harness = makeHarness();
    const preview = await harness.service.stayAmendmentPreview(REQUEST, PROPERTY, dates);
    const input = {
      ...dates,
      priceSource: 'prior' as const,
      previewToken: preview.previewToken,
      idempotencyKey: 'same-key',
    };
    const first = await harness.service.amendStay(REQUEST, PROPERTY, input, { userId: 'staff-1' });
    const second = await harness.service.amendStay(REQUEST, PROPERTY, input, { userId: 'staff-1' });

    expect(second).toEqual(first);
    expect(harness.state.amendments).toHaveLength(1);
    expect(harness.reservation.modifyAcceptedStay).toHaveBeenCalledTimes(1);
    expect(harness.folio.reconcileAcceptedStayAmendment).toHaveBeenCalledTimes(1);
    expect(harness.state.consequences).toHaveLength(1);
    expect(harness.webhook.dispatchPersisted).toHaveBeenCalledTimes(1);
    expect(harness.state.audits.filter((row) =>
      row.bookingRequestId === REQUEST && row.entityType === 'reservation')).toHaveLength(1);

    await expect(harness.service.amendStay(REQUEST, PROPERTY, {
      ...input,
      departureDate: '2026-10-05',
    }, { userId: 'staff-1' })).rejects.toThrow(/idempotency/i);
  });

  it('rejects a stale preview atomically when the quote changes before commit', async () => {
    const harness = makeHarness();
    const preview = await harness.service.stayAmendmentPreview(REQUEST, PROPERTY, dates);
    harness.setQuote(currentQuote('125.00', '12.00'));
    const before = structuredClone(harness.state);

    await expect(harness.service.amendStay(REQUEST, PROPERTY, {
      ...dates,
      priceSource: 'current',
      previewToken: preview.previewToken,
      idempotencyKey: 'stale-preview',
    }, { userId: 'staff-1' })).rejects.toThrow(/preview changed/i);

    expect(harness.state).toEqual(before);
    expect(harness.reservation.modifyAcceptedStay).not.toHaveBeenCalled();
    expect(harness.folio.reconcileAcceptedStayAmendment).not.toHaveBeenCalled();
  });

  it('uses the fingerprint helper over full operational state rather than total alone', () => {
    const base = {
      requestId: REQUEST,
      propertyId: PROPERTY,
      reservationId: RESERVATION,
      reservationUpdatedAt: new Date('2026-08-24T10:05:00.000Z'),
      previousArrivalDate: '2026-10-01',
      previousDepartureDate: '2026-10-03',
      previousTotal: '220.00',
      previousPricing: acceptedPricing,
      arrivalDate: '2026-10-01',
      departureDate: '2026-10-04',
      currentQuote: currentQuote(),
    };
    const first = amendmentPreviewFingerprint(base);
    const changedLine = structuredClone(base);
    changedLine.currentQuote.lineItems[0]!.rate = '121.00';
    expect(amendmentPreviewFingerprint(changedLine)).not.toBe(first);
  });
});
