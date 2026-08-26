import { randomUUID, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  agentWebhookSubscriptions,
  auditLogs,
  bookingEngineCredentials,
  bookingRequestConsequences,
  bookingRequestEmailDeliveries,
  bookingRequestInstallments,
  bookingRequests,
  charges,
  folios,
  payments,
  properties,
  ratePlans,
  reservations,
  rooms,
  roomTypes,
  webhookDeliveries,
} from '@telivityhaip/database';
import { and, eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AllExceptionsFilter } from '../../common/filters/all-exceptions.filter';
import { DRIZZLE } from '../../database/database.module';
import { EmailService } from '../agent/guest-comms/email.service';
import {
  SAVED_PAYMENT_METHOD_GATEWAY,
  type SavedPaymentMethodGateway,
} from '../payment/interfaces/saved-payment-method-gateway.interface';
import { WebhookDeliveryService } from '../webhook/webhook-delivery.service';
import { WebhookService, type WebhookPayload } from '../webhook/webhook.service';

const databaseUrl = process.env['DATABASE_URL'];
const describeDatabase = databaseUrl ? describe : describe.skip;
const PRIVATE_ANSWER = 'E2E_PRIVATE_ANSWER_SENTINEL';
const PRIVATE_CONSENT = 'E2E_PRIVATE_CONSENT_SENTINEL';
const PRIVATE_SETUP_INTENT = 'seti_E2E_PRIVATE_TOKEN';
const PRIVATE_PAYMENT_METHOD = 'pm_E2E_PRIVATE_TOKEN';
const PRIVATE_CARD_BRAND = 'e2e_card_sentinel';
const PRIVATE_CARD_LAST_FOUR = '6789';

const savedPaymentMethodGateway: SavedPaymentMethodGateway = {
  async createSetup() {
    return {
      setupIntentId: PRIVATE_SETUP_INTENT,
      clientSecret: 'seti_E2E_PRIVATE_TOKEN_secret_E2E_PRIVATE_CLIENT_TOKEN',
      customerId: 'cus_E2E_PRIVATE_TOKEN',
      clientMode: 'stripe' as const,
    };
  },
  async resolveSetup() {
    return {
      setupIntentId: PRIVATE_SETUP_INTENT,
      customerId: 'cus_E2E_PRIVATE_TOKEN',
      paymentMethodId: PRIVATE_PAYMENT_METHOD,
      cardLastFour: PRIVATE_CARD_LAST_FOUR,
      cardBrand: PRIVATE_CARD_BRAND,
    };
  },
  async charge(input) {
    return {
      success: true,
      transactionId: `pi_E2E_${input.paymentId}`,
      requiresAction: false,
    };
  },
};

function dateFromNow(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

describeDatabase('Booking Request complete vertical slice', () => {
  const propertyId = randomUUID();
  const roomTypeId = randomUUID();
  const ratePlanId = randomUUID();
  const questionId = randomUUID();
  const bookingKey = `pk_test_e2e_${randomUUID()}`;
  const arrivalDate = dateFromNow(45);
  const departureDate = dateFromNow(47);
  const extendedDepartureDate = dateFromNow(48);
  const instantArrivalDate = dateFromNow(75);
  const instantDepartureDate = dateFromNow(77);
  const applicationKey = `booking-request-e2e-${randomUUID()}`;
  const webhookSubscriptionIds = [randomUUID(), randomUUID()];
  const sentEmails: Array<{ to: string; subject: string; text: string }> = [];
  let app: INestApplication;
  let client: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle>;

  beforeAll(async () => {
    vi.stubEnv('AUTH_ENABLED', 'false');
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('PAYMENT_GATEWAY', 'mock');
    vi.stubEnv('STRIPE_MODE', 'mock');
    if (!process.env['REDIS_URL']) {
      vi.stubEnv('REDIS_URL', 'redis://localhost:6379');
    }

    const root = join(__dirname, '../../../../..');
    execFileSync('node', ['packages/database/dist/push-schema.js'], {
      cwd: root,
      env: { ...process.env, DATABASE_URL: databaseUrl! },
      stdio: 'pipe',
    });

    client = postgres(databaseUrl!, { max: 10 });
    db = drizzle(client);
    await db.insert(properties).values({
      id: propertyId,
      name: 'Booking Request E2E Hotel',
      code: `BRE2E${propertyId.slice(0, 8)}`,
      countryCode: 'ES',
      timezone: 'Europe/Madrid',
      currencyCode: 'EUR',
      totalRooms: 2,
    });
    await db.insert(roomTypes).values({
      id: roomTypeId,
      propertyId,
      name: 'E2E Suite',
      code: 'E2ESUITE',
      maxOccupancy: 4,
      defaultOccupancy: 2,
    });
    await db.insert(rooms).values([
      {
        id: randomUUID(),
        propertyId,
        roomTypeId,
        number: `E2E-${propertyId.slice(0, 4)}-1`,
      },
      {
        id: randomUUID(),
        propertyId,
        roomTypeId,
        number: `E2E-${propertyId.slice(0, 4)}-2`,
      },
    ]);
    await db.insert(ratePlans).values({
      id: ratePlanId,
      propertyId,
      roomTypeId,
      name: 'E2E Flexible',
      code: 'E2EFLEX',
      type: 'bar',
      baseAmount: '100.00',
      currencyCode: 'EUR',
    });
    await db.insert(bookingEngineCredentials).values({
      propertyId,
      label: 'Booking Request E2E widget',
      keyHash: createHash('sha256').update(bookingKey).digest('hex'),
      keyPrefix: bookingKey.slice(0, 12),
    });
    await db.insert(agentWebhookSubscriptions).values(
      webhookSubscriptionIds.map((id, index) => ({
        id,
        propertyId,
        subscriberId: `booking-request-e2e-${propertyId}-${index + 1}`,
        subscriberName: `Booking Request E2E subscriber ${index + 1}`,
        callbackUrl: 'https://8.8.8.8/haip-e2e',
        events: [
          'booking_request.created',
          'booking_request.accepted',
          'payment.received',
          'reservation.modified',
        ],
        secret: `booking-request-e2e-secret-${index + 1}`,
      })),
    );

    const { AppModule } = await import('../../app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EmailService)
      .useValue({
        send: vi.fn(async (message: { to: string; subject: string; text: string }) => {
          sentEmails.push(message);
          return {
            sent: true,
            provider: 'booking-request-e2e',
            messageId: `e2e-${sentEmails.length}`,
          };
        }),
      })
      .overrideProvider(SAVED_PAYMENT_METHOD_GATEWAY)
      .useValue(savedPaymentMethodGateway)
      .overrideProvider(WebhookDeliveryService)
      .useFactory({
        factory: (database: unknown, eventEmitter: EventEmitter2) =>
          new WebhookDeliveryService(
            database,
            eventEmitter,
            { add: async () => undefined },
          ),
        inject: [DRIZZLE, EventEmitter2],
      })
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  }, 120_000);

  afterAll(async () => {
    try {
      await app?.close();
    } finally {
      try {
        if (client) await cleanupPropertyFixture(client, propertyId);
      } finally {
        try {
          await client?.end();
        } finally {
          vi.unstubAllEnvs();
        }
      }
    }
  });

  it('runs request, manual money, acceptance, folio, amendment, and rollout flows together', async () => {
    const http = request(app.getHttpServer());
    const publicRequest = () => http.post('/api/v1/booking-engine/requests')
      .set('x-booking-key', bookingKey);

    const defaultConfig = await http
      .get('/api/v1/admin/booking-engine/config')
      .query({ propertyId })
      .expect(200);
    expect(defaultConfig.body).toMatchObject({
      propertyId,
      isEnabled: false,
      bookingMode: 'instant',
      paymentMethodCollection: 'disabled',
      formQuestions: [],
    });

    const configResponse = await http
      .patch('/api/v1/admin/booking-engine/config')
      .query({ propertyId })
      .send({
        isEnabled: true,
        displayName: 'Booking Request E2E Hotel',
        bookingMode: 'request',
        paymentMethodCollection: 'required',
        stripePublishableKey: 'pk_test_booking_request_e2e',
        sellableRoomTypeIds: [roomTypeId],
        sellableRatePlanIds: [ratePlanId],
        depositPolicy: { type: 'none', refundable: true },
        formQuestions: [{
          id: questionId,
          label: 'Purpose of stay',
          type: 'single_select',
          options: [PRIVATE_ANSWER, 'Business'],
          order: 0,
          isActive: true,
          isRequired: true,
        }],
      })
      .expect(200);
    expect(configResponse.body).toMatchObject({
      propertyId,
      bookingMode: 'request',
      paymentMethodCollection: 'required',
    });

    const setupResponse = await http
      .post('/api/v1/booking-engine/request-payment-method-setup')
      .set('x-booking-key', bookingKey)
      .send({
        guestEmail: 'vertical@example.com',
        applicationId: applicationKey,
        idempotencyKey: `${applicationKey}-card-attempt-1`,
      })
      .expect(201);
    expect(setupResponse.body.setupIntentId).toBe(PRIVATE_SETUP_INTENT);
    expect(setupResponse.body.clientSecret).toContain('E2E_PRIVATE_CLIENT_TOKEN');

    await http
      .post('/api/v1/booking-engine/book')
      .set('x-booking-key', bookingKey)
      .send({
        roomTypeId,
        ratePlanId,
        checkIn: instantArrivalDate,
        checkOut: instantDepartureDate,
        adults: 2,
        children: 0,
        guestFirstName: 'Blocked',
        guestLastName: 'Instant',
        guestEmail: 'blocked-instant@example.com',
      })
      .expect(403);

    const submitResponse = await publicRequest()
      .send({
        idempotencyKey: applicationKey,
        roomTypeId,
        ratePlanId,
        checkIn: arrivalDate,
        checkOut: departureDate,
        guestFirstName: 'Vertical',
        guestLastName: 'Guest',
        guestEmail: 'vertical@example.com',
        guestPhone: '+34 600 000 001',
        adults: 2,
        children: 0,
        specialRequests: 'Quiet room',
        serviceIds: [],
        applicationAnswers: { [questionId]: PRIVATE_ANSWER },
        setupIntentId: setupResponse.body.setupIntentId,
        consentAccepted: true,
        consentText: PRIVATE_CONSENT,
        consentVersion: 'v1',
      })
      .expect(201);
    expect(submitResponse.body).toMatchObject({ status: 'pending' });
    const bookingRequestId = submitResponse.body.requestId as string;

    const pendingRequest = await http
      .get(`/api/v1/booking-requests/${bookingRequestId}`)
      .query({ propertyId })
      .expect(200);
    expect(pendingRequest.body).toMatchObject({
      id: bookingRequestId,
      status: 'pending',
      submittedTotal: '200.00',
      acceptedReservationId: null,
      operationalReservation: null,
      card: { brand: PRIVATE_CARD_BRAND, lastFour: PRIVATE_CARD_LAST_FOUR },
      applicationAnswers: { [questionId]: PRIVATE_ANSWER },
    });
    expect(pendingRequest.body).not.toHaveProperty('stripePaymentMethodId');
    expect(await db.select().from(reservations).where(eq(reservations.propertyId, propertyId)))
      .toHaveLength(0);

    const depositInstallment = await http
      .post(`/api/v1/booking-requests/${bookingRequestId}/installments`)
      .query({ propertyId })
      .send({
        label: '30% before arrival',
        sortOrder: 0,
        percentage: '30.00',
        dueMilestone: 'arrival',
      })
      .expect(201);
    const balanceInstallment = await http
      .post(`/api/v1/booking-requests/${bookingRequestId}/installments`)
      .query({ propertyId })
      .send({
        label: '70% at checkout',
        sortOrder: 1,
        percentage: '70.00',
        dueMilestone: 'checkout',
      })
      .expect(201);
    expect(depositInstallment.body).toMatchObject({
      resolvedAmount: '60.00',
      status: 'unpaid',
    });
    expect(balanceInstallment.body).toMatchObject({
      resolvedAmount: '140.00',
      status: 'unpaid',
    });

    const cardPayment = await http
      .post(`/api/v1/booking-requests/${bookingRequestId}/payments/charge`)
      .query({ propertyId })
      .send({ amount: '30.00', idempotencyKey: `partial-card-${bookingRequestId}` })
      .expect(201);
    expect(cardPayment.body).toMatchObject({
      bookingRequestId,
      folioId: null,
      amount: '30.00',
      status: 'captured',
      source: 'saved_card',
      cardLastFour: PRIVATE_CARD_LAST_FOUR,
    });

    const allocation = await http
      .post(
        `/api/v1/booking-requests/${bookingRequestId}/installments/${depositInstallment.body.id}/allocations`,
      )
      .query({ propertyId })
      .send({ paymentId: cardPayment.body.id, amount: '30.00' })
      .expect(201);
    expect(allocation.body.installment).toMatchObject({
      id: depositInstallment.body.id,
      allocatedAmount: '30.00',
      status: 'partial',
    });

    await db
      .update(ratePlans)
      .set({ baseAmount: '110.00', updatedAt: new Date() })
      .where(and(
        eq(ratePlans.id, ratePlanId),
        eq(ratePlans.propertyId, propertyId),
      ));

    const acceptancePreview = await http
      .get(`/api/v1/booking-requests/${bookingRequestId}/acceptance-preview`)
      .query({ propertyId })
      .expect(200);
    expect(acceptancePreview.body).toMatchObject({
      submittedTotal: '200.00',
      currentTotal: '220.00',
      currencyCode: 'EUR',
    });

    const accepted = await http
      .post(`/api/v1/booking-requests/${bookingRequestId}/accept`)
      .query({ propertyId })
      .send({ priceSource: 'current', previewToken: acceptancePreview.body.previewToken })
      .expect(201);
    expect(accepted.body).toMatchObject({
      requestId: bookingRequestId,
      status: 'accepted',
      totalAmount: '220.00',
      priceSource: 'current',
    });
    const reservationId = accepted.body.reservationId as string;
    const folioId = accepted.body.folioId as string;

    const [acceptedRequestRows, acceptedReservationRows, acceptedFolioRows] = await Promise.all([
      db.select().from(bookingRequests).where(and(
        eq(bookingRequests.id, bookingRequestId),
        eq(bookingRequests.propertyId, propertyId),
      )),
      db.select().from(reservations).where(and(
        eq(reservations.id, reservationId),
        eq(reservations.propertyId, propertyId),
      )),
      db.select().from(folios).where(and(
        eq(folios.id, folioId),
        eq(folios.propertyId, propertyId),
      )),
    ]);
    expect(acceptedRequestRows[0]).toMatchObject({
      acceptedTotal: '220.00',
      acceptedReservationId: reservationId,
      acceptedFolioId: folioId,
      submittedQuoteSnapshot: expect.objectContaining({ grandTotal: '200.00' }),
      currentQuoteSnapshot: expect.objectContaining({ grandTotal: '220.00' }),
    });
    expect(acceptedReservationRows[0]).toMatchObject({
      id: reservationId,
      totalAmount: '220.00',
      acceptedPricingSnapshot: expect.objectContaining({
        grandTotal: '220.00',
        source: 'current',
      }),
    });
    expect(acceptedFolioRows[0]).toMatchObject({
      id: folioId,
      reservationId,
      propertyId,
    });

    const externalPayment = await http
      .post(`/api/v1/booking-requests/${bookingRequestId}/payments/external`)
      .query({ propertyId })
      .send({
        amount: '50.00',
        currencyCode: 'EUR',
        method: 'bank_transfer',
        processedAt: new Date().toISOString(),
        provider: 'bank',
        reference: `BANK-${bookingRequestId}`,
        notes: 'Manually reconciled bank transfer',
      })
      .expect(201);
    expect(externalPayment.body).toMatchObject({
      bookingRequestId,
      folioId,
      amount: '50.00',
      status: 'captured',
      source: 'external',
    });

    await http
      .post(`/api/v1/folios/${folioId}/charges`)
      .send({
        propertyId,
        type: 'minibar',
        description: 'E2E minibar extra',
        amount: '25.00',
        currencyCode: 'EUR',
        taxAmount: '0.00',
        serviceDate: arrivalDate,
        skipTaxCalculation: true,
      })
      .expect(201);

    const amendmentPreview = await http
      .get(`/api/v1/booking-requests/${bookingRequestId}/stay-amendment-preview`)
      .query({
        propertyId,
        arrivalDate,
        departureDate: extendedDepartureDate,
      })
      .expect(200);
    expect(amendmentPreview.body).toMatchObject({
      previousTotal: '220.00',
      currentTotal: '330.00',
      currencyCode: 'EUR',
    });

    const amendment = await http
      .post(`/api/v1/booking-requests/${bookingRequestId}/stay-amendments`)
      .query({ propertyId })
      .send({
        arrivalDate,
        departureDate: extendedDepartureDate,
        priceSource: 'current',
        previewToken: amendmentPreview.body.previewToken,
        idempotencyKey: `extend-${bookingRequestId}`,
      })
      .expect(201);
    expect(amendment.body).toMatchObject({
      reservationId,
      folioId,
      previousTotalAmount: '220.00',
      newTotalAmount: '330.00',
      priceSource: 'current',
    });

    const finalRequest = await http
      .get(`/api/v1/booking-requests/${bookingRequestId}`)
      .query({ propertyId })
      .expect(200);
    expect(finalRequest.body).toMatchObject({
      status: 'accepted',
      arrivalDate,
      departureDate,
      submittedTotal: '200.00',
      acceptedTotal: '220.00',
      acceptedReservationId: reservationId,
      acceptedFolioId: folioId,
      operationalReservation: {
        id: reservationId,
        arrivalDate,
        departureDate: extendedDepartureDate,
        totalAmount: '330.00',
      },
    });

    const paymentState = await http
      .get(`/api/v1/booking-requests/${bookingRequestId}/payments`)
      .query({ propertyId })
      .expect(200);
    expect(paymentState.body.movements).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: cardPayment.body.id, folioId, amount: '30.00' }),
      expect.objectContaining({ id: externalPayment.body.id, folioId, amount: '50.00' }),
    ]));
    expect(paymentState.body.allocations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        paymentId: cardPayment.body.id,
        installmentId: depositInstallment.body.id,
        amount: '30.00',
      }),
    ]));

    const folioState = await http
      .get(`/api/v1/folios/${folioId}`)
      .query({ propertyId })
      .expect(200);
    expect(folioState.body).toMatchObject({
      id: folioId,
      reservationId,
      currencyCode: 'EUR',
      totalCharges: '25.00',
      totalPayments: '80.00',
      balance: '-55.00',
    });

    const emailState = await http
      .get(`/api/v1/booking-requests/${bookingRequestId}/emails`)
      .query({ propertyId })
      .expect(200);
    expect(emailState.body.map((delivery: { kind: string }) => delivery.kind)).toEqual([
      'receipt',
      'payment',
      'accepted',
      'payment',
    ]);
    expect(emailState.body.every((delivery: { status: string }) => delivery.status === 'sent'))
      .toBe(true);
    expect(sentEmails).toHaveLength(4);
    expect(sentEmails.every((message) => message.to === 'vertical@example.com')).toBe(true);

    const auditState = await http
      .get(`/api/v1/booking-requests/${bookingRequestId}/audit-history`)
      .query({ propertyId, limit: 100 })
      .expect(200);
    const summaries = auditState.body.data.map((item: { summary: string }) => item.summary);
    expect(summaries).toEqual(expect.arrayContaining([
      'request.accepted',
      'installment.created',
      'allocation.recorded',
      'payment.captured',
      'email.sent',
      'stay.amended',
    ]));

    const databaseState = await Promise.all([
      db.select().from(bookingRequests).where(and(
        eq(bookingRequests.id, bookingRequestId),
        eq(bookingRequests.propertyId, propertyId),
      )),
      db.select().from(reservations).where(and(
        eq(reservations.id, reservationId),
        eq(reservations.propertyId, propertyId),
      )),
      db.select().from(bookingRequestInstallments).where(eq(
        bookingRequestInstallments.bookingRequestId,
        bookingRequestId,
      )),
      db.select().from(payments).where(eq(payments.bookingRequestId, bookingRequestId)),
      db.select().from(charges).where(eq(charges.folioId, folioId)),
      db.select().from(bookingRequestEmailDeliveries).where(eq(
        bookingRequestEmailDeliveries.bookingRequestId,
        bookingRequestId,
      )),
      db.select().from(auditLogs).where(eq(auditLogs.bookingRequestId, bookingRequestId)),
    ]);
    expect(databaseState.map((rows) => rows.length)).toEqual([1, 1, 2, 2, 1, 4, expect.any(Number)]);
    expect(databaseState[6]!.length).toBeGreaterThanOrEqual(12);
    const persistedRequest = databaseState[0]![0] as typeof bookingRequests.$inferSelect;
    const persistedReservation = databaseState[1]![0] as typeof reservations.$inferSelect;
    expect(persistedRequest).toMatchObject({
      acceptedTotal: '220.00',
    });
    expect(persistedRequest.submittedQuoteSnapshot).toMatchObject({ grandTotal: '200.00' });
    expect(persistedRequest.currentQuoteSnapshot).toMatchObject({ grandTotal: '220.00' });
    expect(persistedReservation).toMatchObject({
      id: reservationId,
      totalAmount: '330.00',
    });
    expect(persistedReservation.acceptedPricingSnapshot).toMatchObject({
      grandTotal: '330.00',
      source: 'current',
    });

    const consequenceRows = await db
      .select()
      .from(bookingRequestConsequences)
      .where(and(
        eq(bookingRequestConsequences.propertyId, propertyId),
        eq(bookingRequestConsequences.bookingRequestId, bookingRequestId),
      ));
    const targetConsequences = consequenceRows.filter((row) => [
      'booking_request.created',
      'booking_request.accepted',
      'payment.received',
      'reservation.modified',
    ].includes((row.payload as { event?: string }).event ?? ''));
    expect(targetConsequences.map((row) => (row.payload as { event: string }).event).sort())
      .toEqual([
        'booking_request.accepted',
        'booking_request.created',
        'payment.received',
        'payment.received',
        'reservation.modified',
      ]);
    expect(new Set(targetConsequences.map((row) => row.id)).size)
      .toBe(targetConsequences.length);
    expect(targetConsequences.every((row) =>
      row.status === 'completed'
      && row.attempts === 1
      && row.completedAt instanceof Date)).toBe(true);

    const queuedDeliveries = await db
      .select()
      .from(webhookDeliveries)
      .where(and(
        eq(webhookDeliveries.propertyId, propertyId),
        inArray(webhookDeliveries.subscriptionId, webhookSubscriptionIds),
      ));
    expect(queuedDeliveries).toHaveLength(
      targetConsequences.length * webhookSubscriptionIds.length,
    );
    expect(queuedDeliveries.every((delivery) =>
      delivery.status === 'pending'
      && delivery.attempts === 0
      && delivery.deliveredAt === null)).toBe(true);
    for (const consequence of targetConsequences) {
      const matchingDeliveries = queuedDeliveries.filter((delivery) =>
        delivery.logicalEventId === consequence.id);
      expect(matchingDeliveries.map((delivery) => delivery.subscriptionId).sort())
        .toEqual([...webhookSubscriptionIds].sort());
      expect(matchingDeliveries.every((delivery) =>
        delivery.eventType === (consequence.payload as { event: string }).event)).toBe(true);
    }

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      Promise.resolve({
        ok: true,
        status: 204,
      } as unknown as Awaited<ReturnType<typeof fetch>>));
    try {
      const deliveryService = app.get(WebhookDeliveryService);
      for (const delivery of queuedDeliveries) {
        await expect(deliveryService.attemptDelivery(delivery.id, propertyId))
          .resolves.toBe('delivered');
      }
      const outboundEventIds = fetchMock.mock.calls.map(([, init]) =>
        new Headers(init?.headers).get('X-HAIP-Event-Id'));
      expect(outboundEventIds.sort()).toEqual(
        queuedDeliveries.map((delivery) => delivery.logicalEventId).sort(),
      );
    } finally {
      fetchMock.mockRestore();
    }
    const deliveredDeliveries = await db
      .select()
      .from(webhookDeliveries)
      .where(and(
        eq(webhookDeliveries.propertyId, propertyId),
        inArray(webhookDeliveries.subscriptionId, webhookSubscriptionIds),
      ));
    expect(deliveredDeliveries.every((delivery) =>
      delivery.status === 'delivered'
      && delivery.attempts === 1
      && delivery.deliveredAt instanceof Date)).toBe(true);

    const payloads = targetConsequences.map((row) => row.payload).concat(
      deliveredDeliveries.map((row) => row.payload as Record<string, unknown>),
    );
    const payloadLeaves = collectPayloadLeaves(payloads);
    expect(payloadLeaves.filter(({ path }) => path.some((segment) =>
      /answer|card|lastFour|consent|paymentMethod|setupIntent|token/i.test(segment))))
      .toEqual([]);
    const payloadStringValues = payloadLeaves
      .map(({ value }) => value)
      .filter((value): value is string => typeof value === 'string');
    for (const privateValue of [
      PRIVATE_ANSWER,
      PRIVATE_CONSENT,
      PRIVATE_SETUP_INTENT,
      PRIVATE_PAYMENT_METHOD,
      PRIVATE_CARD_BRAND,
    ]) {
      expect(payloadStringValues).not.toContain(privateValue);
    }
    expect(JSON.stringify(payloads)).not.toContain('E2E_PRIVATE_');

    const createdConsequence = targetConsequences.find((row) =>
      (row.payload as { event?: string }).event === 'booking_request.created')!;
    const createdDelivery = deliveredDeliveries.find((row) =>
      row.logicalEventId === createdConsequence.id
      && row.subscriptionId === webhookSubscriptionIds[0])!;
    await app.get(WebhookService).dispatchPersisted(
      createdConsequence.payload as unknown as WebhookPayload,
      createdConsequence.id,
    );
    const deduplicatedDeliveries = await db
      .select()
      .from(webhookDeliveries)
      .where(and(
        eq(webhookDeliveries.propertyId, propertyId),
        eq(webhookDeliveries.subscriptionId, webhookSubscriptionIds[0]!),
        eq(webhookDeliveries.logicalEventId, createdConsequence.id),
      ));
    expect(deduplicatedDeliveries).toEqual([
      expect.objectContaining({
        id: createdDelivery.id,
        logicalEventId: createdConsequence.id,
        status: 'delivered',
      }),
    ]);

    await expect(db.insert(payments).values({
      propertyId,
      method: 'cash',
      status: 'captured',
      amount: '1.00',
      currencyCode: 'EUR',
      processedAt: new Date(),
    })).rejects.toThrow(/payments_financial_target_check/);

    await http
      .patch('/api/v1/admin/booking-engine/config')
      .query({ propertyId })
      .send({ bookingMode: 'instant', paymentMethodCollection: 'disabled' })
      .expect(200);

    await publicRequest()
      .send({
        idempotencyKey: `request-disabled-${randomUUID()}`,
        roomTypeId,
        ratePlanId,
        checkIn: instantArrivalDate,
        checkOut: instantDepartureDate,
        guestFirstName: 'Disabled',
        guestLastName: 'Request',
        guestEmail: 'disabled-request@example.com',
        adults: 2,
        applicationAnswers: { [questionId]: 'Business' },
      })
      .expect(403);

    const instantBooking = await http
      .post('/api/v1/booking-engine/book')
      .set('x-booking-key', bookingKey)
      .send({
        roomTypeId,
        ratePlanId,
        checkIn: instantArrivalDate,
        checkOut: instantDepartureDate,
        adults: 2,
        children: 0,
        guestFirstName: 'Instant',
        guestLastName: 'Guest',
        guestEmail: 'instant@example.com',
      })
      .expect(201);
    expect(instantBooking.body).toMatchObject({ success: true });

    await http
      .get(`/api/v1/booking-requests/${bookingRequestId}`)
      .query({ propertyId })
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({ id: bookingRequestId, status: 'accepted' });
      });

    vi.stubEnv('AUTH_ENABLED', 'true');
    try {
      await http
        .get('/api/v1/booking-engine/config')
        .expect(401);
      await http
        .get('/api/v1/booking-engine/config')
        .set('x-booking-key', `pk_invalid_${randomUUID()}`)
        .expect(401);
      await http
        .post('/api/v1/booking-engine/requests')
        .set('x-booking-key', bookingKey)
        .send({ propertyId: randomUUID() })
        .expect(403);
      await http
        .get('/api/v1/booking-engine/config')
        .set('x-booking-key', bookingKey)
        .expect(200)
        .expect(({ body }) => {
          expect(body).toMatchObject({
            propertyId,
            bookingMode: 'instant',
          });
        });
      await http
        .get('/api/v1/booking-engine/requests')
        .set('x-booking-key', bookingKey)
        .expect(404);
      await http
        .get(`/api/v1/booking-engine/requests/${bookingRequestId}`)
        .set('x-booking-key', bookingKey)
        .expect(404);
    } finally {
      vi.stubEnv('AUTH_ENABLED', 'false');
    }
  }, 120_000);
});

function collectPayloadLeaves(
  value: unknown,
  path: string[] = [],
): Array<{ path: string[]; value: unknown }> {
  if (Array.isArray(value)) {
    return value.flatMap((nested, index) =>
      collectPayloadLeaves(nested, [...path, String(index)]));
  }
  if (!value || typeof value !== 'object') return [{ path, value }];
  return Object.entries(value).flatMap(([key, nested]) =>
    collectPayloadLeaves(nested, [...path, key]));
}

async function cleanupPropertyFixture(
  sqlClient: ReturnType<typeof postgres>,
  propertyId: string,
): Promise<void> {
  const guestRows = await sqlClient<{ id: string }[]>`
    SELECT DISTINCT guest_id AS id
    FROM reservations
    WHERE property_id = ${propertyId}
  `;
  const propertyTables = await sqlClient<{ tableName: string }[]>`
    SELECT table_name AS "tableName"
    FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'property_id'
    ORDER BY table_name
  `;
  const foreignKeys = await sqlClient<Array<{
    childTable: string;
    parentTable: string;
  }>>`
    SELECT
      child.relname AS "childTable",
      parent.relname AS "parentTable"
    FROM pg_constraint constraint_row
    JOIN pg_class child ON child.oid = constraint_row.conrelid
    JOIN pg_class parent ON parent.oid = constraint_row.confrelid
    JOIN pg_namespace child_namespace ON child_namespace.oid = child.relnamespace
    JOIN pg_namespace parent_namespace ON parent_namespace.oid = parent.relnamespace
    WHERE constraint_row.contype = 'f'
      AND child_namespace.nspname = 'public'
      AND parent_namespace.nspname = 'public'
  `;
  const deletionOrder = childFirstTableOrder(
    [...propertyTables.map(({ tableName }) => tableName), 'properties'],
    foreignKeys,
  );
  await sqlClient.begin(async (transaction) => {
    for (const tableName of deletionOrder) {
      const quotedTable = `"${tableName.replaceAll('"', '""')}"`;
      const propertyColumn = tableName === 'properties' ? 'id' : 'property_id';
      await transaction.unsafe(
        `DELETE FROM ${quotedTable} WHERE ${propertyColumn} = $1`,
        [propertyId],
      );
    }
    for (const guest of guestRows) {
      await transaction`DELETE FROM guests WHERE id = ${guest.id}`;
    }
  });
  const leftovers = await sqlClient<{ count: number }[]>`
    SELECT count(*)::int AS count FROM properties WHERE id = ${propertyId}
  `;
  if (leftovers[0]?.count !== 0) {
    throw new Error(`Booking Request E2E fixture ${propertyId} was not removed`);
  }
}

function childFirstTableOrder(
  tableNames: string[],
  foreignKeys: Array<{ childTable: string; parentTable: string }>,
): string[] {
  const remaining = new Set(tableNames);
  const scopedForeignKeys = foreignKeys.filter(({ childTable, parentTable }) =>
    childTable !== parentTable
    && remaining.has(childTable)
    && remaining.has(parentTable));
  const ordered: string[] = [];
  while (remaining.size > 0) {
    const children = [...remaining]
      .filter((candidate) => !scopedForeignKeys.some(({ childTable, parentTable }) =>
        parentTable === candidate
        && remaining.has(childTable)
        && remaining.has(parentTable)))
      .sort();
    if (children.length === 0) {
      throw new Error(
        `Cannot clean Booking Request E2E fixture: property table FK cycle (${[
          ...remaining,
        ].sort().join(', ')})`,
      );
    }
    for (const child of children) {
      ordered.push(child);
      remaining.delete(child);
    }
  }
  return ordered;
}
