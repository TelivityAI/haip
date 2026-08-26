import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { Test, type TestingModule } from '@nestjs/testing';
import {
  auditLogs,
  bookingEngineConfig,
  bookingRequestConsequences,
  bookingRequests,
  charges,
  depositLedgerEntries,
  folios,
  payments,
  properties,
  ratePlans,
  reservations,
  rooms,
  roomTypes,
} from '@telivityhaip/database';
import * as schema from '@telivityhaip/database';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DRIZZLE } from '../../database/database.module';
import { BookingEngineConfigService } from '../booking-engine/booking-engine-config.service';
import { BookingEngineService } from '../booking-engine/booking-engine.service';
import { FolioService } from '../folio/folio.service';
import { PAYMENT_GATEWAY } from '../payment/interfaces/payment-gateway.interface';
import type { PaymentGateway } from '../payment/interfaces/payment-gateway.interface';
import { PaymentService } from '../payment/payment.service';
import { StripeWebhookController } from '../payment/stripe-webhook.controller';
import { WebhookService } from '../webhook/webhook.service';
import { BookingRequestService } from './booking-request.service';

const baseDatabaseUrl = process.env['DATABASE_URL'];
const describeDatabase = baseDatabaseUrl ? describe : describe.skip;
const connectionTemplate = baseDatabaseUrl
  ?? 'postgresql://unavailable:unavailable@127.0.0.1:1/haip';

type Fixture = {
  propertyId: string;
  roomTypeId: string;
  ratePlanId: string;
  arrivalDate: string;
  departureDate: string;
};

type StripeWebhookDriver = {
  stripe: { webhooks: { constructEvent: () => Record<string, unknown> } };
  webhookSecret: string;
};

function dateFromNow(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function databaseUrlFor(databaseName: string): string {
  const url = new URL(connectionTemplate);
  url.pathname = `/${databaseName}`;
  url.search = '';
  return url.toString();
}

describeDatabase('Booking Request default-flow release gate', () => {
  const databaseName = `task8_default_flow_${randomBytes(10).toString('hex')}`;
  const adminUrl = (() => {
    const url = new URL(connectionTemplate);
    url.pathname = '/postgres';
    url.search = '';
    return url.toString();
  })();
  const scratchDatabaseUrl = databaseUrlFor(databaseName);
  const admin = postgres(adminUrl, { max: 1 });
  const client = postgres(scratchDatabaseUrl, { max: 8 });
  const db = drizzle(client, { schema });
  const webhookService = {
    emit: vi.fn(async () => undefined),
    dispatchPersisted: vi.fn(async () => undefined),
  };
  const gateway: PaymentGateway = {
    authorize: vi.fn(async () => ({ success: true, transactionId: `pi_${randomUUID()}` })),
    capture: vi.fn(async (transactionId) => ({ success: true, transactionId })),
    void: vi.fn(async (transactionId) => ({ success: true, transactionId })),
    refund: vi.fn(async (transactionId) => ({ success: true, transactionId })),
  };
  let moduleRef: TestingModule;
  let instant: Fixture;
  let optedIn: Fixture;

  beforeAll(async () => {
    vi.stubEnv('AUTH_ENABLED', 'false');
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('PAYMENT_GATEWAY', 'mock');
    vi.stubEnv('STRIPE_MODE', 'mock');
    vi.stubEnv('DATABASE_URL', scratchDatabaseUrl);
    vi.stubEnv('REDIS_URL', process.env['REDIS_URL'] ?? 'redis://localhost:6379');

    await admin.unsafe(`CREATE DATABASE "${databaseName}"`);
    execFileSync('node', ['packages/database/dist/push-schema.js'], {
      cwd: join(__dirname, '../../../../..'),
      env: { ...process.env, DATABASE_URL: scratchDatabaseUrl },
      stdio: 'pipe',
    });

    instant = await createFixture('instant-default', 60);
    optedIn = await createFixture('request-opt-in', 90, 'request');

    const { AppModule } = await import('../../app.module');
    moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DRIZZLE)
      .useValue(db)
      .overrideProvider(PAYMENT_GATEWAY)
      .useValue(gateway)
      .overrideProvider(WebhookService)
      .useValue(webhookService)
      .compile();
    await moduleRef.init();
  }, 120_000);

  afterAll(async () => {
    const failures: unknown[] = [];
    try {
      await moduleRef?.close();
    } catch (error) {
      failures.push(error);
    }
    try {
      await client.end({ timeout: 2 });
    } catch (error) {
      failures.push(error);
    }
    try {
      await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    } catch (error) {
      failures.push(error);
    }
    try {
      await admin.end({ timeout: 2 });
    } catch (error) {
      failures.push(error);
    }
    vi.unstubAllEnvs();
    if (failures.length > 0) {
      throw new AggregateError(failures, 'default-flow release-gate teardown failed');
    }
  });

  it('keeps migrated instant booking, deposit, Stripe refund, and folio behavior shared', async () => {
    const bookingEngine = moduleRef.get(BookingEngineService);
    const config = moduleRef.get(BookingEngineConfigService);
    const stay = {
      roomTypeId: instant.roomTypeId,
      ratePlanId: instant.ratePlanId,
      checkIn: instant.arrivalDate,
      checkOut: instant.departureDate,
      adults: 2,
      children: 0,
    };

    expect(await config.getPublicConfig(instant.propertyId)).toMatchObject({
      propertyId: instant.propertyId,
      bookingMode: 'instant',
      paymentMethodCollection: 'disabled',
      depositPolicy: { type: 'first_night', refundable: true },
    });
    expect(await bookingEngine.quote(instant.propertyId, stay)).toMatchObject({
      currencyCode: 'USD',
      nights: 2,
      grandTotal: '200.00',
      depositDue: '100.00',
    });
    const booking = await bookingEngine.book(instant.propertyId, {
      ...stay,
      guestFirstName: 'Instant',
      guestLastName: 'Default',
      guestEmail: 'instant-default@example.com',
      paymentToken: 'tok_default_flow',
      cardLastFour: '4242',
      cardBrand: 'visa',
    });
    expect(booking).toMatchObject({
      success: true,
      status: 'pending',
      grandTotal: '200.00',
      deposit: { amount: '100.00', status: 'held' },
    });

    const [parent] = await db
      .select()
      .from(payments)
      .where(and(
        eq(payments.id, booking.deposit!.paymentId),
        eq(payments.propertyId, instant.propertyId),
      ));
    const [folio] = await db
      .select()
      .from(folios)
      .where(and(
        eq(folios.reservationId, booking.reservationId),
        eq(folios.propertyId, instant.propertyId),
      ));
    const instantRequests = await db
      .select({ id: bookingRequests.id })
      .from(bookingRequests)
      .where(eq(bookingRequests.propertyId, instant.propertyId));
    const instantDeposits = await db
      .select()
      .from(depositLedgerEntries)
      .where(and(
        eq(depositLedgerEntries.paymentId, parent!.id),
        eq(depositLedgerEntries.propertyId, instant.propertyId),
      ));
    expect(parent).toMatchObject({
      bookingRequestId: null,
      folioId: folio!.id,
      amount: '100.00',
      currencyCode: 'USD',
      status: 'authorized',
      gatewayProvider: 'stripe',
    });
    expect(instantDeposits).toEqual([
      expect.objectContaining({ paymentId: parent!.id, amount: '100.00', status: 'held' }),
    ]);
    expect(instantRequests).toEqual([]);

    await moduleRef.get(FolioService).postCharge(folio!.id, {
      propertyId: instant.propertyId,
      type: 'room',
      description: 'Two-night default-flow stay',
      amount: '200.00',
      currencyCode: 'USD',
      taxAmount: '0.00',
      serviceDate: instant.arrivalDate,
      skipTaxCalculation: true,
    });
    await moduleRef.get(PaymentService).capturePayment(parent!.id, instant.propertyId);
    await expectFolioTotals(folio!.id, instant.propertyId, '200.00', '100.00', '100.00');

    const stripeWebhook = moduleRef.get(StripeWebhookController);
    const stripeDriver = stripeWebhook as unknown as StripeWebhookDriver;
    const charge = {
      id: `ch_${randomUUID()}`,
      payment_intent: parent!.gatewayTransactionId,
      currency: 'usd',
      refunds: { data: [] },
    };
    await expectStripeWebhookAccepted(stripeWebhook, stripeDriver, {
      id: `evt_partial_${randomUUID()}`,
      type: 'charge.refunded',
      data: { object: { ...charge, amount_refunded: 2500 } },
    });
    await expectFolioTotals(folio!.id, instant.propertyId, '200.00', '75.00', '125.00');

    await expectStripeWebhookAccepted(stripeWebhook, stripeDriver, {
      id: `evt_full_${randomUUID()}`,
      type: 'charge.refunded',
      data: { object: { ...charge, amount_refunded: 10000 } },
    });
    const refundChildren = await db
      .select()
      .from(payments)
      .where(and(
        eq(payments.propertyId, instant.propertyId),
        eq(payments.originalPaymentId, parent!.id),
      ));
    expect(refundChildren.map((row) => row.amount).sort()).toEqual(['-25.00', '-75.00']);
    await expectFolioTotals(folio!.id, instant.propertyId, '200.00', '0.00', '200.00');

    const beforeUnrelated = await financialWriteSnapshot();
    for (const event of [
      {
        id: `evt_external_payment_${randomUUID()}`,
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: `pi_external_${randomUUID()}`,
            amount: 1000,
            amount_received: 1000,
            currency: 'usd',
            customer: null,
            payment_method: null,
            metadata: {},
          },
        },
      },
      {
        id: `evt_external_refund_${randomUUID()}`,
        type: 'refund.updated',
        data: {
          object: {
            id: `re_external_${randomUUID()}`,
            status: 'succeeded',
            amount: 1000,
            currency: 'usd',
            metadata: {},
          },
        },
      },
    ]) {
      await expectStripeWebhookAccepted(stripeWebhook, stripeDriver, event);
    }
    expect(await financialWriteSnapshot()).toEqual(beforeUnrelated);
  }, 120_000);

  it('activates request persistence only for a property explicitly configured for request mode', async () => {
    const bookingEngine = moduleRef.get(BookingEngineService);
    const config = moduleRef.get(BookingEngineConfigService);
    const bookingRequest = moduleRef.get(BookingRequestService);
    const stay = {
      roomTypeId: optedIn.roomTypeId,
      ratePlanId: optedIn.ratePlanId,
      checkIn: optedIn.arrivalDate,
      checkOut: optedIn.departureDate,
      adults: 2,
      children: 0,
    };

    expect(await config.getPublicConfig(optedIn.propertyId)).toMatchObject({
      propertyId: optedIn.propertyId,
      bookingMode: 'request',
      paymentMethodCollection: 'disabled',
    });
    await expect(bookingEngine.book(optedIn.propertyId, {
      ...stay,
      guestFirstName: 'Blocked',
      guestLastName: 'Instant',
      guestEmail: 'blocked-instant@example.com',
    })).rejects.toThrow(/staff review/i);

    const submitted = await bookingRequest.submit(optedIn.propertyId, {
      idempotencyKey: `request-opt-in-${randomUUID()}`,
      ...stay,
      guestFirstName: 'Request',
      guestLastName: 'Only',
      guestEmail: 'request-only@example.com',
      applicationAnswers: {},
    });
    expect(submitted).toMatchObject({ status: 'pending' });

    const [requestRow, reservationRows, paymentRows] = await Promise.all([
      db.select().from(bookingRequests).where(and(
        eq(bookingRequests.id, submitted.requestId),
        eq(bookingRequests.propertyId, optedIn.propertyId),
      )),
      db.select({ id: reservations.id }).from(reservations)
        .where(eq(reservations.propertyId, optedIn.propertyId)),
      db.select({ id: payments.id }).from(payments)
        .where(eq(payments.propertyId, optedIn.propertyId)),
    ]);
    expect(requestRow).toEqual([
      expect.objectContaining({
        status: 'pending',
        submittedTotal: '200.00',
        acceptedReservationId: null,
        acceptedFolioId: null,
      }),
    ]);
    expect(reservationRows).toEqual([]);
    expect(paymentRows).toEqual([]);
  }, 120_000);

  async function createFixture(
    label: string,
    arrivalOffset: number,
    bookingMode?: 'request',
  ): Promise<Fixture> {
    const propertyId = randomUUID();
    const roomTypeId = randomUUID();
    const ratePlanId = randomUUID();
    await db.insert(properties).values({
      id: propertyId,
      name: `Task 8 ${label}`,
      code: `T8${randomBytes(5).toString('hex').toUpperCase()}`,
      countryCode: 'US',
      timezone: 'UTC',
      currencyCode: 'USD',
      totalRooms: 1,
    });
    await db.insert(roomTypes).values({
      id: roomTypeId,
      propertyId,
      name: 'Default Flow Room',
      code: 'DEFAULT',
      maxOccupancy: 2,
      defaultOccupancy: 2,
    });
    await db.insert(rooms).values({
      propertyId,
      roomTypeId,
      number: `T8-${randomBytes(4).toString('hex')}`,
    });
    await db.insert(ratePlans).values({
      id: ratePlanId,
      propertyId,
      roomTypeId,
      name: 'Default Flow Rate',
      code: 'DEFAULT',
      type: 'bar',
      baseAmount: '100.00',
      currencyCode: 'USD',
    });
    await db.insert(bookingEngineConfig).values({
      propertyId,
      isEnabled: true,
      sellableRoomTypeIds: [roomTypeId],
      sellableRatePlanIds: [ratePlanId],
      ...(bookingMode ? { bookingMode } : {}),
    });
    return {
      propertyId,
      roomTypeId,
      ratePlanId,
      arrivalDate: dateFromNow(arrivalOffset),
      departureDate: dateFromNow(arrivalOffset + 2),
    };
  }

  async function expectFolioTotals(
    folioId: string,
    propertyId: string,
    totalCharges: string,
    totalPayments: string,
    balance: string,
  ): Promise<void> {
    const [folio] = await db
      .select()
      .from(folios)
      .where(and(eq(folios.id, folioId), eq(folios.propertyId, propertyId)));
    expect(folio).toMatchObject({ totalCharges, totalPayments, balance });
  }

  async function financialWriteSnapshot() {
    const [paymentRows, auditRows, consequenceRows, requestRows, chargeRows] = await Promise.all([
      db.select().from(payments),
      db.select().from(auditLogs),
      db.select().from(bookingRequestConsequences),
      db.select().from(bookingRequests),
      db.select().from(charges),
    ]);
    return { paymentRows, auditRows, consequenceRows, requestRows, chargeRows };
  }
});

async function expectStripeWebhookAccepted(
  controller: StripeWebhookController,
  driver: StripeWebhookDriver,
  event: Record<string, unknown>,
) {
  driver.stripe = { webhooks: { constructEvent: () => event } };
  driver.webhookSecret = 'whsec_task8';
  vi.stubEnv('STRIPE_MODE', 'live');
  const response = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  await controller.handleWebhook({
    headers: { 'stripe-signature': 'task8-signature' },
    body: Buffer.from('{}'),
  }, response);
  expect(response.status).toHaveBeenCalledWith(200);
  expect(response.json).toHaveBeenCalledWith({ received: true });
}
