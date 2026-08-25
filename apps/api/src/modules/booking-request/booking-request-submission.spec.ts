import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  auditLogs,
  bookingEngineConfig,
  bookingRequestConsequences,
  bookingRequests,
} from '@telivityhaip/database';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BookingThrottleGuard } from '../booking-engine/booking-throttle.guard';
import { BookingRequestPublicController } from './booking-request-public.controller';
import { BookingRequestService } from './booking-request.service';
import { CreateRequestCardSetupDto } from './dto/create-request-card-setup.dto';
import { SubmitBookingRequestDto } from './dto/submit-booking-request.dto';

const PROPERTY_ID = 'aaaaaaaa-0000-4000-a000-000000000001';
const REQUEST_ID = 'bbbbbbbb-0000-4000-a000-000000000001';
const CONSEQUENCE_ID = 'bbbbbbbb-0000-4000-a000-000000000002';
const ROOM_TYPE_ID = 'cccccccc-0000-4000-a000-000000000001';
const RATE_PLAN_ID = 'dddddddd-0000-4000-a000-000000000001';
const QUESTION_ID = 'eeeeeeee-0000-4000-a000-000000000001';
const FUTURE_QUESTION_ID = 'eeeeeeee-0000-4000-a000-000000000002';

const formQuestion = {
  id: QUESTION_ID,
  label: 'Purpose of stay',
  type: 'single_select' as const,
  options: ['Leisure', 'Business'],
  order: 0,
  isActive: true,
  isRequired: true,
};

const publicConfig = {
  propertyId: PROPERTY_ID,
  isEnabled: true,
  bookingMode: 'request' as const,
  paymentMethodCollection: 'disabled' as const,
  stripePublishableKey: 'pk_test_public',
  depositPolicy: { type: 'none' as const, refundable: true },
  sellableRoomTypeIds: [ROOM_TYPE_ID],
  sellableRatePlanIds: [RATE_PLAN_ID],
  formQuestions: [formQuestion],
};

const quote = {
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

const submitDto = {
  idempotencyKey: 'widget-attempt-1',
  roomTypeId: ROOM_TYPE_ID,
  ratePlanId: RATE_PLAN_ID,
  checkIn: '2026-10-01',
  checkOut: '2026-10-03',
  guestFirstName: 'Ada',
  guestLastName: 'Lovelace',
  guestEmail: 'ada@example.com',
  guestPhone: '+34 600 000 000',
  adults: 2,
  children: 1,
  specialRequests: 'A quiet room, please.',
  serviceIds: [],
  applicationAnswers: { [QUESTION_ID]: 'Leisure' },
} as SubmitBookingRequestDto;

function makeHarness() {
  let transactionActive = false;
  let insertedValues: Record<string, unknown> | undefined;
  const storedRequests: Array<{
    id: string;
    propertyId: string;
    submissionIdempotencyKey: string;
    submissionFingerprint: string;
    setupIntentId: string | null;
  }> = [];
  const storedConsequences: Array<{
    id: string;
    propertyId: string;
    bookingRequestId: string;
    kind: string;
    payload: Record<string, unknown>;
    status: 'pending' | 'processing' | 'completed';
    attempts: number;
    claimedAt: Date | null;
    lastAttemptAt: Date | null;
    lastError: string | null;
    completedAt: Date | null;
  }> = [];
  const storedAudits: Array<Record<string, unknown>> = [];
  const lockedConfig = {
    ...structuredClone(publicConfig),
    bookingMode: publicConfig.bookingMode as 'instant' | 'request',
    paymentMethodCollection: publicConfig.paymentMethodCollection as
      | 'disabled'
      | 'optional'
      | 'required',
  };
  let pendingValues: Record<string, unknown> | undefined;
  const returning = vi.fn(async () => {
    const key = String(pendingValues?.['submissionIdempotencyKey'] ?? '');
    if (key && storedRequests.some((row) => row.submissionIdempotencyKey === key)) {
      return [];
    }
    const setupIntentId = pendingValues?.['setupIntentId'];
    if (
      setupIntentId
      && storedRequests.some((row) => row.setupIntentId === setupIntentId)
    ) {
      return [];
    }
    if (key) {
      storedRequests.push({
        id: REQUEST_ID,
        propertyId: String(pendingValues?.['propertyId'] ?? ''),
        submissionIdempotencyKey: key,
        submissionFingerprint: String(pendingValues?.['submissionFingerprint'] ?? ''),
        setupIntentId: typeof setupIntentId === 'string' ? setupIntentId : null,
      });
    }
    return [{ id: REQUEST_ID }];
  });
  const values = vi.fn((input: Record<string, unknown>) => {
    insertedValues = input;
    pendingValues = input;
    return {
      returning,
      onConflictDoNothing: vi.fn(() => ({ returning })),
    };
  });
  const consequenceValues = vi.fn((input: Record<string, unknown>) => {
    if (!storedConsequences.some((row) =>
      row.propertyId === input['propertyId']
      && row.bookingRequestId === input['bookingRequestId']
      && row.kind === input['kind'])) {
      storedConsequences.push({
        id: CONSEQUENCE_ID,
        propertyId: String(input['propertyId']),
        bookingRequestId: String(input['bookingRequestId']),
        kind: String(input['kind']),
        payload: structuredClone(input['payload'] as Record<string, unknown>),
        status: 'pending',
        attempts: 0,
        claimedAt: null,
        lastAttemptAt: null,
        lastError: null,
        completedAt: null,
      });
    }
    return Promise.resolve();
  });
  const auditValues = vi.fn((input: Record<string, unknown>) => {
    storedAudits.push(structuredClone(input));
    return Promise.resolve();
  });
  const db: Record<string, unknown> = {
    insert: vi.fn((table: unknown) => {
      if (table === bookingRequests) return { values };
      if (table === bookingRequestConsequences) return { values: consequenceValues };
      if (table === auditLogs) return { values: auditValues };
      throw new Error('Submission attempted a forbidden database write');
    }),
  };
  db['select'] = vi.fn(() => {
    let table: unknown;
    const chain: Record<string, unknown> & PromiseLike<unknown> = {
      from: vi.fn((selectedTable: unknown) => {
        table = selectedTable;
        return chain;
      }),
      where: vi.fn(() => chain),
      for: vi.fn(async () => {
        if (table === bookingEngineConfig) return [lockedConfig];
        if (table === bookingRequestConsequences) return storedConsequences;
        return [];
      }),
      then: (resolve, reject) => Promise.resolve(
        table === bookingRequests
          ? storedRequests
          : table === bookingRequestConsequences
            ? storedConsequences
            : [],
      ).then(resolve, reject),
    };
    return chain;
  });
  db['update'] = vi.fn((table: unknown) => {
    if (table !== bookingRequestConsequences) {
      throw new Error('Submission attempted a forbidden database update');
    }
    return {
      set: vi.fn((changes: Record<string, unknown>) => ({
        where: vi.fn(() => {
          const row = storedConsequences[0];
          if (row) Object.assign(row, changes);
          const result = row ? [structuredClone(row)] : [];
          return {
            returning: vi.fn(async () => result),
            then: (
              resolve: (value: unknown) => unknown,
              reject: (reason: unknown) => unknown,
            ) => Promise.resolve(result).then(resolve, reject),
          };
        }),
      })),
    };
  });
  let transactionQueue = Promise.resolve();
  db['transaction'] = vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => {
    const previous = transactionQueue;
    let release = () => undefined;
    transactionQueue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    transactionActive = true;
    try {
      return await callback(db);
    } finally {
      transactionActive = false;
      release();
    }
  });
  const config = {
    getPublicConfig: vi.fn().mockResolvedValue(structuredClone(publicConfig)),
  };
  const availability = {
    searchAvailability: vi.fn().mockResolvedValue([
      { roomTypeId: ROOM_TYPE_ID, date: '2026-10-01', available: 1 },
      { roomTypeId: ROOM_TYPE_ID, date: '2026-10-02', available: 1 },
    ]),
  };
  const ratePlan = {
    assertSellable: vi.fn().mockResolvedValue(undefined),
  };
  const bookingEngine = {
    quote: vi.fn().mockResolvedValue(structuredClone(quote)),
  };
  const savedPaymentMethod = {
    createSetup: vi.fn().mockResolvedValue({
      setupIntentId: 'seti_trusted',
      clientSecret: 'seti_trusted_secret_value',
      customerId: 'cus_trusted',
      clientMode: 'stripe' as const,
    }),
    resolveSetup: vi.fn().mockResolvedValue({
      setupIntentId: 'seti_trusted',
      customerId: 'cus_trusted',
      paymentMethodId: 'pm_trusted',
      cardLastFour: '4242',
      cardBrand: 'visa',
    }),
  };
  const webhook = {
    emit: vi.fn().mockResolvedValue(undefined),
    dispatchPersisted: vi.fn().mockResolvedValue(undefined),
  };
  const mailer = {
    queue: vi.fn(async () => {
      expect(transactionActive).toBe(true);
      return 'email-delivery-1';
    }),
    deliverForRequestBestEffort: vi.fn(async () => {
      expect(transactionActive).toBe(false);
    }),
  };
  const service = new BookingRequestService(
    db as unknown as ConstructorParameters<typeof BookingRequestService>[0],
    config as unknown as ConstructorParameters<typeof BookingRequestService>[1],
    bookingEngine as unknown as ConstructorParameters<typeof BookingRequestService>[2],
    availability as unknown as ConstructorParameters<typeof BookingRequestService>[3],
    ratePlan as unknown as ConstructorParameters<typeof BookingRequestService>[4],
    savedPaymentMethod as unknown as ConstructorParameters<typeof BookingRequestService>[5],
    webhook as unknown as ConstructorParameters<typeof BookingRequestService>[6],
    undefined as unknown as ConstructorParameters<typeof BookingRequestService>[7],
    undefined as unknown as ConstructorParameters<typeof BookingRequestService>[8],
    undefined as unknown as ConstructorParameters<typeof BookingRequestService>[9],
    undefined as unknown as ConstructorParameters<typeof BookingRequestService>[10],
    mailer as unknown as ConstructorParameters<typeof BookingRequestService>[11],
  );

  return {
    service,
    db,
    config,
    availability,
    ratePlan,
    bookingEngine,
    savedPaymentMethod,
    webhook,
    mailer,
    values,
    consequenceValues,
    auditValues,
    lockedConfig,
    storedRequests,
    storedConsequences,
    storedAudits,
    get insertedValues() {
      return insertedValues;
    },
  };
}

describe('BookingRequestPublicController validation contract', () => {
  it('retains concrete DTO metadata for the global Nest validation pipe', () => {
    expect(Reflect.getMetadata(
      'design:paramtypes',
      BookingRequestPublicController.prototype,
      'createSetup',
    )?.[0]).toBe(CreateRequestCardSetupDto);
    expect(Reflect.getMetadata(
      'design:paramtypes',
      BookingRequestPublicController.prototype,
      'submit',
    )?.[0]).toBe(SubmitBookingRequestDto);
  });

  it('throttles both public write endpoints', () => {
    const setupGuards = Reflect.getMetadata(
      GUARDS_METADATA,
      BookingRequestPublicController.prototype.createSetup,
    ) as unknown[];
    const submitGuards = Reflect.getMetadata(
      GUARDS_METADATA,
      BookingRequestPublicController.prototype.submit,
    ) as unknown[];

    expect(setupGuards).toContain(BookingThrottleGuard);
    expect(submitGuards).toContain(BookingThrottleGuard);
  });

  it('enforces the setup-route throttle guard once its property budget is exhausted', () => {
    const originalNodeEnv = process.env['NODE_ENV'];
    process.env['NODE_ENV'] = 'production';
    try {
      const config = {
        get: (key: string, fallback: string) => {
          if (key === 'BOOKING_RATE_LIMIT_MAX') return '1';
          if (key === 'BOOKING_RATE_LIMIT_WINDOW_MS') return '60000';
          if (key === 'RATE_LIMIT_DISABLED') return 'false';
          return fallback;
        },
      } as unknown as ConstructorParameters<typeof BookingThrottleGuard>[0];
      const guard = new BookingThrottleGuard(config);
      const context = {
        switchToHttp: () => ({
          getRequest: () => ({
            ip: '203.0.113.10',
            bookingEngine: { propertyId: PROPERTY_ID },
          }),
        }),
      } as unknown as Parameters<BookingThrottleGuard['canActivate']>[0];

      expect(guard.canActivate(context)).toBe(true);
      expect(() => guard.canActivate(context)).toThrow(/Too many booking attempts/);
    } finally {
      if (originalNodeEnv === undefined) delete process.env['NODE_ENV'];
      else process.env['NODE_ENV'] = originalNodeEnv;
    }
  });
});

describe('SubmitBookingRequestDto calendar dates and replay key', () => {
  async function errors(overrides: Record<string, unknown>) {
    return validate(plainToInstance(SubmitBookingRequestDto, {
      ...submitDto,
      ...overrides,
    }));
  }

  it.each([
    ['2026-10-01T12:00:00Z', '2026-10-03'],
    ['2026-02-30', '2026-03-03'],
    ['2026-10-03', '2026-10-03'],
    ['2026-10-04', '2026-10-03'],
  ])('rejects a non-canonical stay from %s to %s', async (checkIn, checkOut) => {
    const result = await errors({ checkIn, checkOut });

    expect(result.some((error) => ['checkIn', 'checkOut'].includes(error.property))).toBe(true);
  });

  it('requires a durable client submission idempotency key', async () => {
    const result = await errors({ idempotencyKey: undefined });

    expect(result.some((error) => error.property === 'idempotencyKey')).toBe(true);
  });
});

describe('BookingRequestService public card setup', () => {
  it.each([
    ['the booking engine is disabled', { isEnabled: false }, ForbiddenException],
    ['the property uses instant mode', { bookingMode: 'instant' }, ForbiddenException],
    [
      'card collection is disabled',
      { paymentMethodCollection: 'disabled' },
      BadRequestException,
    ],
    ['no public card key is configured', { stripePublishableKey: null }, BadRequestException],
  ])('rejects setup when %s', async (_reason, configOverride, errorType) => {
    const harness = makeHarness();
    harness.config.getPublicConfig.mockResolvedValue({
      ...structuredClone(publicConfig),
      paymentMethodCollection: 'optional',
      ...configOverride,
    });

    await expect(harness.service.createPaymentMethodSetup(PROPERTY_ID, {
      guestEmail: 'ada@example.com',
      idempotencyKey: 'widget-attempt-1',
    })).rejects.toBeInstanceOf(errorType);
    expect(harness.savedPaymentMethod.createSetup).not.toHaveBeenCalled();
  });

  it('creates an idempotent setup only for request-mode card collection', async () => {
    const harness = makeHarness();
    harness.config.getPublicConfig.mockResolvedValue({
      ...structuredClone(publicConfig),
      paymentMethodCollection: 'optional',
    });

    await expect(harness.service.createPaymentMethodSetup(PROPERTY_ID, {
      guestEmail: 'ada@example.com',
      idempotencyKey: 'widget-attempt-1',
    })).resolves.toEqual({
      setupIntentId: 'seti_trusted',
      clientSecret: 'seti_trusted_secret_value',
      clientMode: 'stripe',
    });
    expect(harness.savedPaymentMethod.createSetup).toHaveBeenCalledWith(
      'ada@example.com',
      `booking-request:${PROPERTY_ID}:widget-attempt-1`,
      { propertyId: PROPERTY_ID, applicationId: 'widget-attempt-1' },
    );
  });
});

describe('BookingRequestService.submit', () => {
  let harness: ReturnType<typeof makeHarness>;

  beforeEach(() => {
    harness = makeHarness();
  });

  it('rejects request submission in instant mode before validation or writes', async () => {
    harness.config.getPublicConfig.mockResolvedValue({
      ...structuredClone(publicConfig),
      bookingMode: 'instant',
    });

    await expect(harness.service.submit(PROPERTY_ID, submitDto)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(harness.ratePlan.assertSellable).not.toHaveBeenCalled();
    expect(harness.db.insert).not.toHaveBeenCalled();
  });

  it('validates answers against the current active form before writes', async () => {
    await expect(harness.service.submit(PROPERTY_ID, {
      ...submitDto,
      applicationAnswers: {},
    })).rejects.toThrow(/Purpose of stay/);
    expect(harness.ratePlan.assertSellable).not.toHaveBeenCalled();
    expect(harness.db.insert).not.toHaveBeenCalled();
  });

  it('rejects a stale or invalid rate plan before availability and quote work', async () => {
    harness.ratePlan.assertSellable.mockRejectedValue(
      new BadRequestException('Rate plan is inactive'),
    );

    await expect(harness.service.submit(PROPERTY_ID, submitDto)).rejects.toThrow(
      'Rate plan is inactive',
    );
    expect(harness.ratePlan.assertSellable).toHaveBeenCalledWith(
      PROPERTY_ID,
      RATE_PLAN_ID,
      '2026-10-01',
      '2026-10-03',
    );
    expect(harness.availability.searchAvailability).not.toHaveBeenCalled();
    expect(harness.db.insert).not.toHaveBeenCalled();
  });

  it('keeps zero availability as waitlist behavior and creates no request', async () => {
    harness.availability.searchAvailability.mockResolvedValue([
      { roomTypeId: ROOM_TYPE_ID, date: '2026-10-01', available: 1 },
      { roomTypeId: ROOM_TYPE_ID, date: '2026-10-02', available: 0 },
    ]);

    await expect(harness.service.submit(PROPERTY_ID, submitDto)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(harness.bookingEngine.quote).not.toHaveBeenCalled();
    expect(harness.db.insert).not.toHaveBeenCalled();
  });

  it('rejects a partial availability response for the requested stay', async () => {
    harness.availability.searchAvailability.mockResolvedValue([
      { roomTypeId: ROOM_TYPE_ID, date: '2026-10-01', available: 1 },
    ]);

    await expect(harness.service.submit(PROPERTY_ID, submitDto)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(harness.db.insert).not.toHaveBeenCalled();
  });

  it('rejects date-times before they can bypass complete-stay availability checks', async () => {
    await expect(harness.service.submit(PROPERTY_ID, {
      ...submitDto,
      checkIn: '2026-10-01T12:00:00Z',
    })).rejects.toBeInstanceOf(BadRequestException);
    expect(harness.ratePlan.assertSellable).not.toHaveBeenCalled();
    expect(harness.availability.searchAvailability).not.toHaveBeenCalled();
    expect(harness.db.insert).not.toHaveBeenCalled();
  });

  it('requires a successful setup and explicit consent under the required policy', async () => {
    harness.config.getPublicConfig.mockResolvedValue({
      ...structuredClone(publicConfig),
      paymentMethodCollection: 'required',
    });

    await expect(harness.service.submit(PROPERTY_ID, submitDto)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(harness.service.submit(PROPERTY_ID, {
      ...submitDto,
      setupIntentId: 'seti_trusted',
    })).rejects.toBeInstanceOf(BadRequestException);
    expect(harness.savedPaymentMethod.resolveSetup).not.toHaveBeenCalled();
    expect(harness.db.insert).not.toHaveBeenCalled();
  });

  it('allows optional card collection to be skipped explicitly by omitting setup data', async () => {
    harness.config.getPublicConfig.mockResolvedValue({
      ...structuredClone(publicConfig),
      paymentMethodCollection: 'optional',
    });
    harness.lockedConfig.paymentMethodCollection = 'optional';

    await expect(harness.service.submit(PROPERTY_ID, submitDto)).resolves.toEqual({
      requestId: REQUEST_ID,
      status: 'pending',
      message: 'Your booking request has been received and is pending review.',
    });
    expect(harness.savedPaymentMethod.resolveSetup).not.toHaveBeenCalled();
    expect(harness.insertedValues).toMatchObject({
      stripeCustomerId: null,
      stripePaymentMethodId: null,
      cardLastFour: null,
      cardBrand: null,
      consentText: null,
      consentVersion: null,
      consentedAt: null,
    });
  });

  it.each(['required', 'optional'] as const)(
    'resolves trusted saved-card details and stores consent for %s collection',
    async (paymentMethodCollection) => {
      harness.config.getPublicConfig.mockResolvedValue({
        ...structuredClone(publicConfig),
        paymentMethodCollection,
      });
      harness.lockedConfig.paymentMethodCollection = paymentMethodCollection;
      const dto = {
        ...submitDto,
        setupIntentId: 'seti_client_reference_only',
        consentAccepted: true,
        consentText: 'Save this card for later staff-initiated payments; no charge is made now.',
        consentVersion: 'request-card-v1',
      } satisfies SubmitBookingRequestDto;

      await harness.service.submit(PROPERTY_ID, dto);

      expect(harness.savedPaymentMethod.resolveSetup).toHaveBeenCalledWith(
        'seti_client_reference_only',
        { propertyId: PROPERTY_ID, applicationId: 'widget-attempt-1' },
      );
      expect(harness.insertedValues).toMatchObject({
        setupIntentId: 'seti_trusted',
        stripeCustomerId: 'cus_trusted',
        stripePaymentMethodId: 'pm_trusted',
        cardLastFour: '4242',
        cardBrand: 'visa',
        consentText: dto.consentText,
        consentVersion: 'request-card-v1',
      });
      expect(harness.insertedValues?.['consentedAt']).toBeInstanceOf(Date);
    },
  );

  it('rejects optional setup data without matching consent and disabled setup data entirely', async () => {
    harness.config.getPublicConfig.mockResolvedValue({
      ...structuredClone(publicConfig),
      paymentMethodCollection: 'optional',
    });
    await expect(harness.service.submit(PROPERTY_ID, {
      ...submitDto,
      setupIntentId: 'seti_trusted',
    })).rejects.toBeInstanceOf(BadRequestException);

    harness.config.getPublicConfig.mockResolvedValue(structuredClone(publicConfig));
    await expect(harness.service.submit(PROPERTY_ID, {
      ...submitDto,
      setupIntentId: 'seti_trusted',
      consentAccepted: true,
      consentText: 'Unexpected consent',
      consentVersion: 'unexpected-v1',
    })).rejects.toBeInstanceOf(BadRequestException);
    expect(harness.savedPaymentMethod.resolveSetup).not.toHaveBeenCalled();
    expect(harness.db.insert).not.toHaveBeenCalled();
  });

  it('turns an untrusted or incomplete SetupIntent into a validation failure', async () => {
    harness.config.getPublicConfig.mockResolvedValue({
      ...structuredClone(publicConfig),
      paymentMethodCollection: 'required',
    });
    harness.savedPaymentMethod.resolveSetup.mockRejectedValue(
      new Error('Stripe SetupIntent has not succeeded'),
    );

    await expect(harness.service.submit(PROPERTY_ID, {
      ...submitDto,
      setupIntentId: 'seti_untrusted',
      consentAccepted: true,
      consentText: 'Save the card without charging it now.',
      consentVersion: 'request-card-v1',
    })).rejects.toBeInstanceOf(BadRequestException);
    expect(harness.db.insert).not.toHaveBeenCalled();
  });

  it('persists immutable authoritative snapshots and returns acknowledgement only', async () => {
    const currentConfig = structuredClone(publicConfig);
    const currentQuote = structuredClone(quote);
    harness.config.getPublicConfig.mockResolvedValue(currentConfig);
    harness.bookingEngine.quote.mockResolvedValue(currentQuote);
    const dto = structuredClone(submitDto);

    const acknowledgement = await harness.service.submit(PROPERTY_ID, dto);

    expect(harness.bookingEngine.quote).toHaveBeenCalledWith(PROPERTY_ID, {
      roomTypeId: ROOM_TYPE_ID,
      ratePlanId: RATE_PLAN_ID,
      checkIn: '2026-10-01',
      checkOut: '2026-10-03',
      adults: 2,
      children: 1,
      serviceIds: [],
    });
    expect(harness.db.insert).toHaveBeenCalledTimes(3);
    expect(harness.values).toHaveBeenCalledOnce();
    expect(harness.insertedValues).toMatchObject({
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
      formSnapshot: [formQuestion],
      applicationAnswers: { [QUESTION_ID]: 'Leisure' },
      submittedQuoteSnapshot: quote,
      currentQuoteSnapshot: null,
      currencyCode: 'EUR',
    });
    expect(harness.insertedValues?.['formSnapshot']).not.toBe(currentConfig.formQuestions);
    expect(harness.insertedValues?.['submittedQuoteSnapshot']).not.toBe(currentQuote);

    currentConfig.formQuestions[0]!.label = 'Changed after submission';
    currentQuote.grandTotal = '9999.00';
    dto.applicationAnswers[QUESTION_ID] = 'Business';
    expect(harness.insertedValues?.['formSnapshot']).toEqual([formQuestion]);
    expect(harness.insertedValues?.['submittedQuoteSnapshot']).toEqual(quote);
    expect(harness.insertedValues?.['applicationAnswers']).toEqual({
      [QUESTION_ID]: 'Leisure',
    });
    expect(acknowledgement).toEqual({
      requestId: REQUEST_ID,
      status: 'pending',
      message: 'Your booking request has been received and is pending review.',
    });
    expect(Object.keys(acknowledgement).sort()).toEqual(['message', 'requestId', 'status']);
  });

  it('commits a durable audit/outbox and dispatches its sanitized created event', async () => {
    await harness.service.submit(PROPERTY_ID, submitDto);

    expect(harness.storedConsequences).toHaveLength(1);
    expect(harness.storedConsequences[0]).toMatchObject({
      propertyId: PROPERTY_ID,
      bookingRequestId: REQUEST_ID,
      kind: 'created_event',
      status: 'completed',
      attempts: 1,
      lastError: null,
    });
    expect(harness.storedAudits).toEqual([expect.objectContaining({
      propertyId: PROPERTY_ID,
      action: 'create',
      entityType: 'booking_request',
      entityId: REQUEST_ID,
      description: 'Webhook event: booking_request.created',
    })]);
    const payload = expect.objectContaining({
      event: 'booking_request.created',
      entityType: 'booking_request',
      entityId: REQUEST_ID,
      propertyId: PROPERTY_ID,
      data: { requestId: REQUEST_ID, status: 'pending' },
      timestamp: expect.any(String),
    });
    expect(harness.storedConsequences[0]?.payload).toEqual(payload);
    expect(harness.storedAudits[0]?.['newValue']).toEqual(payload);
    expect(harness.webhook.dispatchPersisted).toHaveBeenCalledWith(
      payload,
      CONSEQUENCE_ID,
    );
    expect(harness.values.mock.invocationCallOrder[0]).toBeLessThan(
      harness.webhook.dispatchPersisted.mock.invocationCallOrder[0]!,
    );
    expect(JSON.stringify(harness.webhook.dispatchPersisted.mock.calls)).not.toContain('Leisure');
    expect(JSON.stringify(harness.webhook.dispatchPersisted.mock.calls)).not.toContain('consent');
    expect(JSON.stringify(harness.webhook.dispatchPersisted.mock.calls)).not.toContain('seti_');
    expect(harness.mailer.queue).toHaveBeenCalledWith(expect.objectContaining({
      propertyId: PROPERTY_ID,
      bookingRequestId: REQUEST_ID,
      logicalKey: 'request:receipt',
      kind: 'receipt',
      recipient: 'ada@example.com',
    }), harness.db);
    expect(JSON.stringify(harness.mailer.queue.mock.calls)).not.toMatch(
      /Leisure|consent|seti_|pm_|cus_|widget-attempt|https?:\/\//i,
    );
    expect(harness.mailer.deliverForRequestBestEffort).toHaveBeenCalledWith(
      REQUEST_ID,
      PROPERTY_ID,
    );
  });

  it('does not roll back a submitted request when post-commit email delivery fails', async () => {
    harness.mailer.deliverForRequestBestEffort.mockRejectedValueOnce(
      new Error('transport unavailable'),
    );

    await expect(harness.service.submit(PROPERTY_ID, submitDto)).resolves.toMatchObject({
      requestId: REQUEST_ID,
      status: 'pending',
    });
    expect(harness.storedRequests).toHaveLength(1);
    expect(harness.storedConsequences).toHaveLength(1);
  });

  it('returns the existing acknowledgement for an exact replay without repeating work', async () => {
    const first = await harness.service.submit(PROPERTY_ID, submitDto);
    const replay = await harness.service.submit(PROPERTY_ID, structuredClone(submitDto));

    expect(replay).toEqual(first);
    expect(harness.values).toHaveBeenCalledOnce();
    expect(harness.bookingEngine.quote).toHaveBeenCalledOnce();
    expect(harness.webhook.dispatchPersisted).toHaveBeenCalledOnce();
  });

  it('conflicts when a replay key is reused for a different submission payload', async () => {
    await harness.service.submit(PROPERTY_ID, submitDto);

    await expect(harness.service.submit(PROPERTY_ID, {
      ...submitDto,
      guestLastName: 'Byron',
    })).rejects.toBeInstanceOf(ConflictException);
    expect(harness.values).toHaveBeenCalledOnce();
    expect(harness.webhook.dispatchPersisted).toHaveBeenCalledOnce();
  });

  it('rejects reuse of one trusted SetupIntent under another application key', async () => {
    harness.config.getPublicConfig.mockResolvedValue({
      ...structuredClone(publicConfig),
      paymentMethodCollection: 'required',
    });
    harness.lockedConfig.paymentMethodCollection = 'required';
    const withCard = {
      ...submitDto,
      setupIntentId: 'seti_client_reference_only',
      consentAccepted: true,
      consentText: 'Save this card for staff-initiated payments; no charge is made now.',
      consentVersion: 'request-card-v1',
    } satisfies SubmitBookingRequestDto;
    await harness.service.submit(PROPERTY_ID, withCard);

    await expect(harness.service.submit(PROPERTY_ID, {
      ...withCard,
      idempotencyKey: 'widget-attempt-2',
    })).rejects.toBeInstanceOf(ConflictException);
    expect(harness.webhook.dispatchPersisted).toHaveBeenCalledOnce();
  });

  it('collapses concurrent exact replays into one request and one created event', async () => {
    const [first, replay] = await Promise.all([
      harness.service.submit(PROPERTY_ID, structuredClone(submitDto)),
      harness.service.submit(PROPERTY_ID, structuredClone(submitDto)),
    ]);

    expect(replay).toEqual(first);
    expect(harness.values).toHaveBeenCalledOnce();
    expect(harness.storedConsequences).toHaveLength(1);
    expect(harness.storedAudits).toHaveLength(1);
    expect(harness.webhook.dispatchPersisted).toHaveBeenCalledOnce();
  });

  it('persists a failed consequence, retries it on replay, and never redelivers completion', async () => {
    harness.webhook.dispatchPersisted.mockRejectedValueOnce(new Error('delivery unavailable'));

    await expect(harness.service.submit(PROPERTY_ID, submitDto)).resolves.toEqual({
      requestId: REQUEST_ID,
      status: 'pending',
      message: 'Your booking request has been received and is pending review.',
    });
    expect(harness.storedConsequences[0]).toMatchObject({
      status: 'pending',
      attempts: 1,
      lastError: 'delivery unavailable',
      completedAt: null,
    });
    expect(harness.storedAudits).toHaveLength(1);

    await expect(harness.service.submit(PROPERTY_ID, structuredClone(submitDto))).resolves.toEqual({
      requestId: REQUEST_ID,
      status: 'pending',
      message: 'Your booking request has been received and is pending review.',
    });
    expect(harness.storedConsequences[0]).toMatchObject({
      status: 'completed',
      attempts: 2,
      lastError: null,
    });

    await expect(harness.service.submit(PROPERTY_ID, structuredClone(submitDto))).resolves.toEqual({
      requestId: REQUEST_ID,
      status: 'pending',
      message: 'Your booking request has been received and is pending review.',
    });
    expect(harness.values).toHaveBeenCalledOnce();
    expect(harness.consequenceValues).toHaveBeenCalledOnce();
    expect(harness.auditValues).toHaveBeenCalledOnce();
    expect(harness.webhook.dispatchPersisted).toHaveBeenCalledTimes(2);
  });

  it('allows only one concurrent replay to claim a pending consequence', async () => {
    harness.webhook.dispatchPersisted.mockRejectedValueOnce(new Error('delivery unavailable'));
    await harness.service.submit(PROPERTY_ID, submitDto);

    await Promise.all([
      harness.service.submit(PROPERTY_ID, structuredClone(submitDto)),
      harness.service.submit(PROPERTY_ID, structuredClone(submitDto)),
    ]);

    expect(harness.values).toHaveBeenCalledOnce();
    expect(harness.storedConsequences).toHaveLength(1);
    expect(harness.storedConsequences[0]).toMatchObject({
      status: 'completed',
      attempts: 2,
      lastError: null,
    });
    expect(harness.webhook.dispatchPersisted).toHaveBeenCalledTimes(2);
  });

  it('does not commit when the locked final config has switched to instant mode', async () => {
    harness.lockedConfig.bookingMode = 'instant';

    await expect(harness.service.submit(PROPERTY_ID, submitDto)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(harness.values).not.toHaveBeenCalled();
    expect(harness.webhook.dispatchPersisted).not.toHaveBeenCalled();
  });

  it('ignores a stored active future question in both public and locked config semantics', async () => {
    (harness.lockedConfig.formQuestions as Array<Record<string, unknown>>).push({
      id: FUTURE_QUESTION_ID,
      label: 'Future satisfaction score',
      type: 'rating_scale',
      order: 1,
      isActive: true,
      isRequired: false,
      futureConfig: { maximum: 5, icon: 'star' },
    });

    await expect(harness.service.submit(PROPERTY_ID, submitDto)).resolves.toMatchObject({
      requestId: REQUEST_ID,
      status: 'pending',
    });
    expect(harness.insertedValues?.['formSnapshot']).toEqual([formQuestion]);
  });

  it('still detects a supported question change during the locked config recheck', async () => {
    harness.lockedConfig.formQuestions[0] = {
      ...harness.lockedConfig.formQuestions[0]!,
      label: 'Updated purpose of stay',
    };

    await expect(harness.service.submit(PROPERTY_ID, submitDto)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(harness.values).not.toHaveBeenCalled();
  });

  it('does not commit a card-policy snapshot that changed during submission', async () => {
    harness.lockedConfig.paymentMethodCollection = 'required';

    await expect(harness.service.submit(PROPERTY_ID, submitDto)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(harness.values).not.toHaveBeenCalled();
    expect(harness.webhook.dispatchPersisted).not.toHaveBeenCalled();
  });
});
