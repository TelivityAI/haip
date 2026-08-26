import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { Test, type TestingModule } from '@nestjs/testing';
import {
  auditLogs,
  bookingEngineConfig,
  bookingRequestConsequences,
  bookingRequestEmailDeliveries,
  bookingRequestInstallments,
  bookingRequestPaymentAllocations,
  bookingRequestPaymentResolutions,
  bookingRequestStayAmendments,
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
  webhookDeliveries,
} from '@telivityhaip/database';
import * as schema from '@telivityhaip/database';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
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
import { BookingRequestService } from './booking-request.service';

const baseDatabaseUrl = process.env['DATABASE_URL'];
const describeDatabase = baseDatabaseUrl ? describe : describe.skip;
const connectionTemplate = baseDatabaseUrl
  ?? 'postgresql://unavailable:unavailable@127.0.0.1:1/haip';
const DATABASE_UTILITY_TIMEOUT_MS = 30_000;
const PUSH_SCHEMA_TIMEOUT_MS = 60_000;

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
  return url.toString();
}

function runDatabaseUtility(
  command: 'createdb' | 'dropdb',
  databaseName: string,
): void {
  const maintenanceUrl = new URL(connectionTemplate);
  maintenanceUrl.pathname = '/postgres';
  const databasePassword = decodeURIComponent(maintenanceUrl.password);
  const publicMaintenanceUrl = new URL(maintenanceUrl);
  publicMaintenanceUrl.password = '';
  const utilityArgs = [
    `--maintenance-db=${publicMaintenanceUrl.toString()}`,
    '--no-password',
    ...(command === 'dropdb' ? ['--if-exists', '--force'] : []),
    databaseName,
  ];
  const childEnv = { ...process.env, PGPASSWORD: databasePassword };
  const hostResult = execFileBounded(command, utilityArgs, {
    env: childEnv,
    label: `PostgreSQL ${command}`,
    secret: databasePassword,
    timeout: DATABASE_UTILITY_TIMEOUT_MS,
    tolerateMissing: true,
  });
  if (hostResult !== undefined) return;

  const host = maintenanceUrl.hostname;
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(host)) {
    throw new Error(
      `${command} is required to provision the remote PostgreSQL test database`,
    );
  }
  const publishedPort = maintenanceUrl.port || '5432';
  const containerOutput = execFileBounded('docker', [
    'ps',
    '--filter',
    `publish=${publishedPort}`,
    '--format',
    '{{.Names}}',
  ], {
    env: childEnv,
    label: 'PostgreSQL container lookup',
    secret: databasePassword,
    timeout: DATABASE_UTILITY_TIMEOUT_MS,
  });
  const containers = containerOutput!.toString().trim().split('\n').filter(Boolean);
  if (containers.length !== 1) {
    throw new Error(
      `${command} is unavailable and PostgreSQL container lookup for port ${publishedPort} `
      + `returned ${containers.length} matches`,
    );
  }
  execFileBounded('docker', [
    'exec',
    '--env',
    'PGPASSWORD',
    containers[0]!,
    command,
    '--username',
    decodeURIComponent(maintenanceUrl.username),
    '--maintenance-db',
    'postgres',
    '--no-password',
    ...(command === 'dropdb' ? ['--if-exists', '--force'] : []),
    databaseName,
  ], {
    env: childEnv,
    label: `containerized PostgreSQL ${command}`,
    secret: databasePassword,
    timeout: DATABASE_UTILITY_TIMEOUT_MS,
  });
}

function isMissingExecutable(error: unknown): boolean {
  return error instanceof Error
    && 'code' in error
    && (error as NodeJS.ErrnoException).code === 'ENOENT';
}

function execFileBounded(
  command: string,
  args: string[],
  options: {
    env: NodeJS.ProcessEnv;
    label: string;
    secret: string;
    timeout: number;
    tolerateMissing?: boolean;
    cwd?: string;
  },
): Buffer | undefined {
  try {
    return execFileSync(command, args, {
      env: options.env,
      cwd: options.cwd,
      stdio: 'pipe',
      timeout: options.timeout,
    });
  } catch (error: unknown) {
    if (options.tolerateMissing && isMissingExecutable(error)) return undefined;
    throw sanitizedChildError(options.label, error, options.secret);
  }
}

function sanitizedChildError(label: string, error: unknown, secret: string): Error {
  const childError = error as {
    code?: string | number;
    message?: string;
    status?: number | null;
    signal?: NodeJS.Signals | null;
    stderr?: Buffer | string;
  };
  const rawDetail = childError.stderr?.toString().trim()
    || childError.message?.trim()
    || '';
  const detail = sanitizeDiagnostic(rawDetail, secret);
  const rawOutcome = childError.signal
    ? `signal ${childError.signal}`
    : childError.status !== undefined && childError.status !== null
      ? `exit ${childError.status}`
      : childError.code !== undefined
        ? `code ${childError.code}`
        : 'exit unknown';
  const outcome = sanitizeDiagnostic(rawOutcome, secret);
  return new Error(`${label} failed (${outcome})${detail ? `: ${detail}` : ''}`);
}

function sanitizeDiagnostic(value: string, secret: string): string {
  const structurallySanitized = value
    .replace(/\b(postgres(?:ql)?:\/\/)[^\s/?#@]*@/gi, '$1')
    .replace(
      /\b(password\s*=\s*)(?:'(?:\\[\s\S]|[^'\\])*'|"(?:\\[\s\S]|[^"\\])*"|(?:\\[\s\S]|[^\s])+)/gi,
      '$1[redacted]',
    );
  const sensitiveValues = [
    secret,
    encodeURIComponent(secret),
    connectionTemplate,
    databaseUrlFor('postgres'),
  ].filter(Boolean);
  return sensitiveValues.reduce(
    (sanitized, sensitive) => sanitized.replaceAll(sensitive, '[redacted]'),
    structurallySanitized,
  ).slice(-2_000);
}

describe('default-flow release-gate diagnostic sanitization', () => {
  it('removes URL userinfo and conninfo passwords while retaining useful context', () => {
    const leakedUrl = 'postgresql://u:p%27word@host/task8_x?sslmode=require';
    const error = sanitizedChildError('database schema installation', {
      status: 1,
      stderr: Buffer.from(
        `createdb: ${leakedUrl} failed; password='p\\'word' authentication rejected; `
        + 'password=foo\\ bar host=db',
      ),
    }, "p'word");

    expect(error.message).toContain(
      'createdb: postgresql://host/task8_x?sslmode=require failed',
    );
    expect(error.message).toContain('password=[redacted] authentication rejected');
    expect(error.message).not.toContain('u:');
    expect(error.message).not.toContain('p%27word');
    expect(error.message).not.toContain("p'word");
    expect(error.message).not.toContain("p\\'word");
    expect(error.message).toContain('password=[redacted] host=db');
    expect(error.message).not.toContain('foo\\ bar');

    const metadataOnlyError = Object.assign(
      new Error(`spawn failed for ${leakedUrl}; password=foo\\ bar host=db`),
      { code: 'ENOENT' },
    );
    const metadataOnly = sanitizedChildError(
      'PostgreSQL createdb',
      metadataOnlyError,
      "p'word",
    );
    expect(metadataOnly.message).toContain('(code ENOENT)');
    expect(metadataOnly.message).toContain(
      'spawn failed for postgresql://host/task8_x?sslmode=require; '
      + 'password=[redacted] host=db',
    );
    expect(metadataOnly.message).not.toContain('u:p%27word');
    expect(metadataOnly.message).not.toContain('foo\\ bar');

    const mixedLineEndings = [
      `password=unquoted\\${'\n'}linefeed host=lf`,
      `password='single\\${'\r'}carriage' host=cr`,
      `password="double\\${'\r\n'}pair" host=crlf`,
      `password=unicode\\${'\u2028'}separator host=unicode`,
    ].join('; ');
    const multiline = sanitizedChildError('PostgreSQL dropdb', {
      status: 1,
      stderr: Buffer.from(mixedLineEndings),
    }, 'unrelated-secret');
    expect(multiline.message).toContain([
      'password=[redacted] host=lf',
      'password=[redacted] host=cr',
      'password=[redacted] host=crlf',
      'password=[redacted] host=unicode',
    ].join('; '));
    expect(multiline.message).not.toContain('linefeed');
    expect(multiline.message).not.toContain('carriage');
    expect(multiline.message).not.toContain('pair');
    expect(multiline.message).not.toContain('separator');
  });
});

describeDatabase('Booking Request default-flow release gate', () => {
  const databaseName = `task8_default_flow_${randomBytes(10).toString('hex')}`;
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
      provider: 'task8-memory',
      messageId: 'task8-receipt-message',
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
  let optedIn: Fixture;

  beforeAll(async () => {
    vi.stubEnv('AUTH_ENABLED', 'false');
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('PAYMENT_GATEWAY', 'mock');
    vi.stubEnv('STRIPE_MODE', 'mock');
    vi.stubEnv('DATABASE_URL', scratchDatabaseUrl);
    vi.stubEnv('REDIS_URL', process.env['REDIS_URL'] ?? 'redis://localhost:6379');

    runDatabaseUtility('createdb', databaseName);
    execFileBounded('node', ['packages/database/dist/push-schema.js'], {
      cwd: join(__dirname, '../../../../..'),
      env: { ...process.env, DATABASE_URL: scratchDatabaseUrl },
      label: 'database schema installation',
      secret: decodeURIComponent(new URL(scratchDatabaseUrl).password),
      timeout: PUSH_SCHEMA_TIMEOUT_MS,
    });

    instant = await createFixture('instant-default', 60);
    optedIn = await createFixture('request-opt-in', 90, 'request');

    const { AppModule } = await import('../../app.module');
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
      throw new AggregateError(failures, 'default-flow release-gate teardown failed');
    }
  });

  it('keeps final-schema database-default instant booking and shared financial behavior', async () => {
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
    const beforeWebhookCalls = {
      emit: webhookService.emit.mock.calls.length,
      dispatchPersisted: webhookService.dispatchPersisted.mock.calls.length,
    };
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
    expect({
      emit: webhookService.emit.mock.calls.length,
      dispatchPersisted: webhookService.dispatchPersisted.mock.calls.length,
    }).toEqual(beforeWebhookCalls);
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

    const [
      requestRow,
      reservationRows,
      paymentRows,
      consequenceRows,
      emailRows,
    ] = await Promise.all([
      db.select().from(bookingRequests).where(and(
        eq(bookingRequests.id, submitted.requestId),
        eq(bookingRequests.propertyId, optedIn.propertyId),
      )),
      db.select({ id: reservations.id }).from(reservations)
        .where(eq(reservations.propertyId, optedIn.propertyId)),
      db.select({ id: payments.id }).from(payments)
        .where(eq(payments.propertyId, optedIn.propertyId)),
      db.select().from(bookingRequestConsequences)
        .where(eq(bookingRequestConsequences.propertyId, optedIn.propertyId)),
      db.select().from(bookingRequestEmailDeliveries)
        .where(eq(bookingRequestEmailDeliveries.propertyId, optedIn.propertyId)),
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
    expect(consequenceRows).toEqual([
      expect.objectContaining({
        bookingRequestId: submitted.requestId,
        kind: 'created_event',
        status: 'completed',
        attempts: 1,
      }),
    ]);
    expect(emailRows).toEqual([
      expect.objectContaining({
        bookingRequestId: submitted.requestId,
        kind: 'receipt',
        status: 'sent',
        attempts: 1,
        automaticAttempts: 1,
        providerMessageId: 'task8-receipt-message',
      }),
    ]);
    expect(emailService.send).toHaveBeenCalledOnce();
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
    const [
      paymentRows,
      chargeRows,
      folioRows,
      depositRows,
      reservationRows,
      requestRows,
      installmentRows,
      allocationRows,
      resolutionRows,
      amendmentRows,
      consequenceRows,
      emailRows,
      webhookRows,
      auditRows,
    ] = await Promise.all([
      // Service queries remain tenant-scoped. This inventory is intentionally
      // global because the scratch database is isolated: it must catch a broken
      // unrelated-event path that writes under either fixture or no tenant.
      db.select().from(payments),
      db.select().from(charges),
      db.select().from(folios),
      db.select().from(depositLedgerEntries),
      db.select().from(reservations),
      db.select().from(bookingRequests),
      db.select().from(bookingRequestInstallments),
      db.select().from(bookingRequestPaymentAllocations),
      db.select().from(bookingRequestPaymentResolutions),
      db.select().from(bookingRequestStayAmendments),
      db.select().from(bookingRequestConsequences),
      db.select().from(bookingRequestEmailDeliveries),
      db.select().from(webhookDeliveries),
      db.select().from(auditLogs),
    ]);
    return {
      paymentRows,
      chargeRows,
      folioRows,
      depositRows,
      reservationRows,
      requestRows,
      installmentRows,
      allocationRows,
      resolutionRows,
      amendmentRows,
      consequenceRows,
      emailRows,
      webhookRows,
      auditRows,
    };
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
