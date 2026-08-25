import { randomUUID, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  auditLogs,
  bookingEngineCredentials,
  bookingRequestEmailDeliveries,
  bookingRequestInstallments,
  bookingRequests,
  charges,
  payments,
  properties,
  ratePlans,
  reservations,
  rooms,
  roomTypes,
} from '@telivityhaip/database';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AllExceptionsFilter } from '../../common/filters/all-exceptions.filter';
import { EmailService } from '../agent/guest-comms/email.service';

const databaseUrl = process.env['DATABASE_URL'];
const describeDatabase = databaseUrl ? describe : describe.skip;

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
  const sentEmails: Array<{ to: string; subject: string; text: string }> = [];
  let app: INestApplication;
  let client: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle>;

  beforeAll(async () => {
    process.env['AUTH_ENABLED'] = 'false';
    process.env['NODE_ENV'] = 'test';
    process.env['PAYMENT_GATEWAY'] = 'mock';
    process.env['STRIPE_MODE'] = 'mock';
    process.env['REDIS_URL'] = process.env['REDIS_URL'] ?? 'redis://localhost:6379';

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
    await app?.close();
    await client?.end();
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
          options: ['Leisure', 'Business'],
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
      .send({ guestEmail: 'vertical@example.com', idempotencyKey: applicationKey })
      .expect(201);
    expect(setupResponse.body.setupIntentId).toMatch(/^seti_mock_/);
    expect(setupResponse.body.clientSecret).toContain('_secret_mock');

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
        applicationAnswers: { [questionId]: 'Leisure' },
        setupIntentId: setupResponse.body.setupIntentId,
        consentAccepted: true,
        consentText: 'I authorize staff-initiated charges for this stay.',
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
      card: { brand: 'visa', lastFour: '4242' },
      applicationAnswers: { [questionId]: 'Leisure' },
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
      cardLastFour: '4242',
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

    const acceptancePreview = await http
      .get(`/api/v1/booking-requests/${bookingRequestId}/acceptance-preview`)
      .query({ propertyId })
      .expect(200);
    expect(acceptancePreview.body).toMatchObject({
      submittedTotal: '200.00',
      currentTotal: '200.00',
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
      totalAmount: '200.00',
      priceSource: 'current',
    });
    const reservationId = accepted.body.reservationId as string;
    const folioId = accepted.body.folioId as string;

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
      previousTotal: '200.00',
      currentTotal: '300.00',
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
      previousTotalAmount: '200.00',
      newTotalAmount: '300.00',
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
      acceptedTotal: '200.00',
      acceptedReservationId: reservationId,
      acceptedFolioId: folioId,
      operationalReservation: {
        id: reservationId,
        arrivalDate,
        departureDate: extendedDepartureDate,
        totalAmount: '300.00',
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
  }, 120_000);
});
