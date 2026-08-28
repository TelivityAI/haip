/**
 * Flag-OFF default-install release gate.
 *
 * Verifies the deployment default (HAIP_BOOKING_REQUESTS unset/false) still
 * works end to end when the optional booking-requests package is never
 * touched: only core migrations run, AppModule boots without the
 * booking-requests Nest module, `booking_requests` and friends do not exist
 * in the schema, and the pre-existing instant-booking + deposit/refund path
 * (the only path a default install has) keeps working. Mirrors the instant
 * half of booking-request-default-flow-regression.spec.ts, but that spec
 * always sets HAIP_BOOKING_REQUESTS=true — it never exercises what most
 * production installs actually run.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { Test, type TestingModule } from '@nestjs/testing';
import { and, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as schema from '@telivityhaip/database';
import {
  bookingEngineConfig,
  depositLedgerEntries,
  folios,
  payments,
  properties,
  ratePlans,
  rooms,
  roomTypes,
} from '@telivityhaip/database';
import { DRIZZLE } from '../../database/database.module';
import { EmailService } from '../agent/guest-comms/email.service';
import { BookingEngineConfigService } from '../booking-engine/booking-engine-config.service';
import { BookingEngineService } from '../booking-engine/booking-engine.service';
import { FolioService } from '../folio/folio.service';
import { PAYMENT_GATEWAY } from '../payment/interfaces/payment-gateway.interface';
import type { PaymentGateway } from '../payment/interfaces/payment-gateway.interface';
import { PaymentService } from '../payment/payment.service';
import { StripeWebhookController } from '../payment/stripe-webhook.controller';
import { WebhookService } from '../webhook/webhook.service';
import { createRegressionDatabaseHelpers } from './regression-database-utils.js';

const baseDatabaseUrl = process.env['DATABASE_URL'];
const describeDatabase = baseDatabaseUrl ? describe : describe.skip;
const connectionTemplate = baseDatabaseUrl
  ?? 'postgresql://unavailable:unavailable@127.0.0.1:1/haip';
const { databaseUrlFor, execFileBounded, runDatabaseUtility } =
  createRegressionDatabaseHelpers(connectionTemplate);
const CORE_MIGRATION_TIMEOUT_MS = 60_000;

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

describeDatabase('Booking engine flag-OFF default-install release gate', () => {
  const databaseName = `flagoff_default_install_${randomBytes(10).toString('hex')}`;
  const scratchDatabaseUrl = databaseUrlFor(databaseName);
  const client = postgres(scratchDatabaseUrl, { max: 8 });
  const db = drizzle(client, { schema });
  const webhookService = {
    emit: vi.fn(async () => undefined),
    dispatchPersisted: vi.fn(async () => undefined),
  };
  const emailService = {
    isConfigured: vi.fn(() => true),
    send: vi.fn(async () => ({
      sent: true,
      provider: 'flag-off-memory',
      messageId: 'flag-off-receipt-message',
    })),
  };
  const gateway: PaymentGateway = {
    authorize: vi.fn(async () => ({ success: true, transactionId: `pi_${randomUUID()}` })),
    capture: vi.fn(async (transactionId) => ({ success: true, transactionId })),
    void: vi.fn(async (transactionId) => ({ success: true, transactionId })),
    refund: vi.fn(async (transactionId) => ({ success: true, transactionId })),
  };
  let moduleRef: TestingModule;
  let instant: Fixture;

  beforeAll(async () => {
    // The point of this suite: HAIP_BOOKING_REQUESTS is deliberately left
    // unset, matching a default install/clone that never opted into the
    // optional package.
    vi.stubEnv('HAIP_BOOKING_REQUESTS', '');
    vi.stubEnv('AUTH_ENABLED', 'false');
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('PAYMENT_GATEWAY', 'mock');
    vi.stubEnv('STRIPE_MODE', 'mock');
    vi.stubEnv('DATABASE_URL', scratchDatabaseUrl);
    vi.stubEnv('REDIS_URL', process.env['REDIS_URL'] ?? 'redis://localhost:6379');

    runDatabaseUtility('createdb', databaseName);
    execFileBounded('node', ['packages/database/dist/run-migrations.js'], {
      cwd: join(__dirname, '../../../../..'),
      env: { ...process.env, DATABASE_URL: scratchDatabaseUrl },
      label: 'core database schema installation',
      secret: decodeURIComponent(new URL(scratchDatabaseUrl).password),
      timeout: CORE_MIGRATION_TIMEOUT_MS,
    });
    // Deliberately no `pnpm --filter @telivityhaip/booking-requests db:migrate`
    // here — a default install never runs it.

    instant = await createFixture('flag-off-instant', 60);

    const { preloadBookingRequestsModules } = await import('../../booking-requests.bootstrap.js');
    await preloadBookingRequestsModules();
    const { AppModule } = await import('../../app.module.js');
    moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DRIZZLE)
      .useValue(db)
      .overrideProvider(PAYMENT_GATEWAY)
      .useValue(gateway)
      .overrideProvider(EmailService)
      .useValue(emailService)
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
      runDatabaseUtility('dropdb', databaseName);
    } catch (error) {
      failures.push(error);
    }
    vi.unstubAllEnvs();
    if (failures.length > 0) {
      throw new AggregateError(failures, 'flag-off release-gate teardown failed');
    }
  });

  it('never creates the optional booking-requests tables when the flag is off', async () => {
    const [row] = await db.execute<{ exists: boolean }>(sql`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables WHERE table_name = 'booking_requests'
      ) AS exists
    `);
    expect(row!.exists).toBe(false);
  });

  it('boots AppModule without a BookingRequestService provider registered', async () => {
    const { BookingRequestService } = await import('@telivityhaip/booking-requests');
    expect(() => moduleRef.get(BookingRequestService)).toThrow();
  });

  it('rejects switching bookingMode to request when the deployment flag is off', async () => {
    const config = moduleRef.get(BookingEngineConfigService);
    await expect(config.updateConfig(
      instant.propertyId,
      { bookingMode: 'request' },
      undefined,
      { userId: null, userEmail: null, ipAddress: null },
    )).rejects.toThrow(/HAIP_BOOKING_REQUESTS/);
  });

  it('keeps instant booking, deposit capture, and partial/full refunds working with only core migrations applied', async () => {
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
      guestFirstName: 'FlagOff',
      guestLastName: 'Default',
      guestEmail: 'flag-off-default@example.com',
      paymentToken: 'tok_flag_off',
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

    await moduleRef.get(FolioService).postCharge(folio!.id, {
      propertyId: instant.propertyId,
      type: 'room',
      description: 'Two-night flag-off stay',
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
  }, 120_000);

  async function createFixture(label: string, arrivalOffset: number): Promise<Fixture> {
    const propertyId = randomUUID();
    const roomTypeId = randomUUID();
    const ratePlanId = randomUUID();
    await db.insert(properties).values({
      id: propertyId,
      name: `Flag Off ${label}`,
      code: `FO${randomBytes(5).toString('hex').toUpperCase()}`,
      countryCode: 'US',
      timezone: 'UTC',
      currencyCode: 'USD',
      totalRooms: 1,
    });
    await db.insert(roomTypes).values({
      id: roomTypeId,
      propertyId,
      name: 'Flag Off Room',
      code: 'DEFAULT',
      maxOccupancy: 2,
      defaultOccupancy: 2,
    });
    await db.insert(rooms).values({
      propertyId,
      roomTypeId,
      number: `FO-${randomBytes(4).toString('hex')}`,
    });
    await db.insert(ratePlans).values({
      id: ratePlanId,
      propertyId,
      roomTypeId,
      name: 'Flag Off Rate',
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
});

async function expectStripeWebhookAccepted(
  controller: StripeWebhookController,
  driver: StripeWebhookDriver,
  event: Record<string, unknown>,
) {
  driver.stripe = { webhooks: { constructEvent: () => event } };
  driver.webhookSecret = 'whsec_flag_off';
  vi.stubEnv('STRIPE_MODE', 'live');
  const response = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  await controller.handleWebhook({
    headers: { 'stripe-signature': 'flag-off-signature' },
    body: Buffer.from('{}'),
  }, response);
  expect(response.status).toHaveBeenCalledWith(200);
  expect(response.json).toHaveBeenCalledWith({ received: true });
}
