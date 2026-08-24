import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { bookingRequests } from '@telivityhaip/database';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BookingRequestPublicController } from './booking-request-public.controller';
import { BookingRequestService } from './booking-request.service';
import { CreateRequestCardSetupDto } from './dto/create-request-card-setup.dto';
import { SubmitBookingRequestDto } from './dto/submit-booking-request.dto';

const PROPERTY_ID = 'aaaaaaaa-0000-4000-a000-000000000001';
const REQUEST_ID = 'bbbbbbbb-0000-4000-a000-000000000001';
const ROOM_TYPE_ID = 'cccccccc-0000-4000-a000-000000000001';
const RATE_PLAN_ID = 'dddddddd-0000-4000-a000-000000000001';
const QUESTION_ID = 'eeeeeeee-0000-4000-a000-000000000001';

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

const submitDto: SubmitBookingRequestDto = {
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
};

function makeHarness() {
  let insertedValues: Record<string, unknown> | undefined;
  const returning = vi.fn().mockResolvedValue([{ id: REQUEST_ID }]);
  const values = vi.fn((input: Record<string, unknown>) => {
    insertedValues = input;
    return { returning };
  });
  const db = {
    insert: vi.fn((table: unknown) => {
      if (table !== bookingRequests) {
        throw new Error('Submission attempted a non-request database write');
      }
      return { values };
    }),
  };
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
    }),
    resolveSetup: vi.fn().mockResolvedValue({
      setupIntentId: 'seti_trusted',
      customerId: 'cus_trusted',
      paymentMethodId: 'pm_trusted',
      cardLastFour: '4242',
      cardBrand: 'visa',
    }),
  };
  const webhook = { emit: vi.fn().mockResolvedValue(undefined) };
  const service = new BookingRequestService(
    db as unknown as ConstructorParameters<typeof BookingRequestService>[0],
    config as unknown as ConstructorParameters<typeof BookingRequestService>[1],
    bookingEngine as unknown as ConstructorParameters<typeof BookingRequestService>[2],
    availability as unknown as ConstructorParameters<typeof BookingRequestService>[3],
    ratePlan as unknown as ConstructorParameters<typeof BookingRequestService>[4],
    savedPaymentMethod as unknown as ConstructorParameters<typeof BookingRequestService>[5],
    webhook as unknown as ConstructorParameters<typeof BookingRequestService>[6],
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
    values,
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
    });
    expect(harness.savedPaymentMethod.createSetup).toHaveBeenCalledWith(
      'ada@example.com',
      `booking-request:${PROPERTY_ID}:widget-attempt-1`,
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
      );
      expect(harness.insertedValues).toMatchObject({
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
    expect(harness.db.insert).toHaveBeenCalledOnce();
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

  it('emits a sanitized created event after the request write', async () => {
    await harness.service.submit(PROPERTY_ID, submitDto);

    expect(harness.webhook.emit).toHaveBeenCalledWith(
      'booking_request.created',
      'booking_request',
      REQUEST_ID,
      { requestId: REQUEST_ID, status: 'pending' },
      PROPERTY_ID,
    );
    expect(harness.values.mock.invocationCallOrder[0]).toBeLessThan(
      harness.webhook.emit.mock.invocationCallOrder[0]!,
    );
    expect(JSON.stringify(harness.webhook.emit.mock.calls)).not.toContain('Leisure');
    expect(JSON.stringify(harness.webhook.emit.mock.calls)).not.toContain('consent');
    expect(JSON.stringify(harness.webhook.emit.mock.calls)).not.toContain('seti_');
  });
});
