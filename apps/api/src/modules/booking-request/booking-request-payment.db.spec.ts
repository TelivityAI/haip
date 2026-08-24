import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { eq } from 'drizzle-orm';
import {
  auditLogs,
  bookingRequestInstallments,
  bookingRequestPaymentResolutions,
  bookingRequests,
  payments,
  properties,
  ratePlans,
  roomTypes,
} from '@telivityhaip/database';
import { describe, expect, it, vi, beforeAll, afterAll } from 'vitest';
import { BookingRequestPaymentService } from './booking-request-payment.service';

const databaseUrl = process.env['PAYMENT_DB_TEST_URL'];
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase('Booking Request payment PostgreSQL concurrency contract', () => {
  const propertyId = '71000000-0000-4000-a000-000000000001';
  const roomTypeId = '71000000-0000-4000-a000-000000000002';
  const ratePlanId = '71000000-0000-4000-a000-000000000003';
  const requestId = '71000000-0000-4000-a000-000000000004';
  const paymentId = '71000000-0000-4000-a000-000000000005';
  let client: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle>;

  beforeAll(async () => {
    client = postgres(databaseUrl!, { max: 10 });
    db = drizzle(client);
    await db.insert(properties).values({
      id: propertyId,
      name: 'Task 7 payment test',
      code: 'TASK7PAY',
      countryCode: 'ES',
      timezone: 'Europe/Madrid',
      currencyCode: 'EUR',
      totalRooms: 1,
    });
    await db.insert(roomTypes).values({
      id: roomTypeId,
      propertyId,
      name: 'Test room',
      code: 'TEST',
      maxOccupancy: 2,
      defaultOccupancy: 2,
    });
    await db.insert(ratePlans).values({
      id: ratePlanId,
      propertyId,
      roomTypeId,
      name: 'Test rate',
      code: 'TEST',
      type: 'bar',
      baseAmount: '100.00',
      currencyCode: 'EUR',
    });
    await db.insert(bookingRequests).values({
      id: requestId,
      propertyId,
      submissionIdempotencyKey: 'task-7-db-concurrency',
      submissionFingerprint: 'a'.repeat(64),
      arrivalDate: '2026-09-01',
      departureDate: '2026-09-02',
      roomTypeId,
      ratePlanId,
      guestFirstName: 'Task',
      guestLastName: 'Seven',
      guestEmail: 'task7@example.com',
      submittedQuoteSnapshot: { grandTotal: '100.00' },
      currencyCode: 'EUR',
    });
    await db.insert(payments).values({
      id: paymentId,
      propertyId,
      bookingRequestId: requestId,
      idempotencyKey: 'booking-request-charge:task-7-db-parent',
      method: 'credit_card',
      status: 'captured',
      amount: '100.00',
      currencyCode: 'EUR',
      gatewayProvider: 'stripe',
      gatewayTransactionId: 'pi_task_7_db',
      processedAt: new Date(),
    });
  });

  afterAll(async () => {
    if (!client) return;
    await db.delete(auditLogs).where(eq(auditLogs.propertyId, propertyId));
    await db.delete(bookingRequestPaymentResolutions)
      .where(eq(bookingRequestPaymentResolutions.bookingRequestId, requestId));
    await db.delete(payments).where(eq(payments.bookingRequestId, requestId));
    await db.delete(bookingRequests).where(eq(bookingRequests.id, requestId));
    await db.delete(ratePlans).where(eq(ratePlans.id, ratePlanId));
    await db.delete(roomTypes).where(eq(roomTypes.id, roomTypeId));
    await db.delete(properties).where(eq(properties.id, propertyId));
    await client.end();
  });

  it('serializes different-key claims so pending capacity cannot be over-reserved', async () => {
    let release!: (value: { success: true; transactionId: string }) => void;
    const refundGateway = {
      refund: vi.fn(() => new Promise((resolve) => { release = resolve; })),
    };
    const service = new (BookingRequestPaymentService as any)(
      db,
      { charge: vi.fn() },
      { recalculateBalance: vi.fn() },
      refundGateway,
    ) as BookingRequestPaymentService;

    const first = service.refund(
      requestId,
      paymentId,
      propertyId,
      { amount: '50.00', idempotencyKey: 'db-first-half' },
    );
    await vi.waitFor(() => expect(refundGateway.refund).toHaveBeenCalledTimes(1));

    await expect(service.refund(
      requestId,
      paymentId,
      propertyId,
      { amount: '50.01', idempotencyKey: 'db-overreserve' },
    )).rejects.toThrow(/remaining captured amount/i);

    release({ success: true, transactionId: 're_task_7_db' });
    await expect(first).resolves.toMatchObject({
      movement: { amount: '-50.00' },
      resolution: { status: 'completed' },
    });
    const rows = await db.select().from(bookingRequestPaymentResolutions)
      .where(eq(bookingRequestPaymentResolutions.bookingRequestId, requestId));
    expect(rows).toEqual([
      expect.objectContaining({ amount: '50.00', status: 'completed' }),
    ]);
  });

  it('enforces positive parent, installment shape, and retained-reason checks', async () => {
    await expect(db.insert(payments).values({
      propertyId,
      bookingRequestId: requestId,
      method: 'cash',
      status: 'captured',
      amount: '0.00',
      currencyCode: 'EUR',
    })).rejects.toMatchObject({
      constraint_name: 'payments_booking_request_parent_positive_check',
    });

    await expect(db.insert(bookingRequestInstallments).values({
      propertyId,
      bookingRequestId: requestId,
      label: 'Invalid shape',
      fixedAmount: '10.00',
      percentage: '10.00',
      resolvedAmount: '10.00',
      dueMilestone: 'manual',
    })).rejects.toMatchObject({
      constraint_name: 'booking_request_installments_amount_kind_check',
    });

    await expect(db.insert(bookingRequestPaymentResolutions).values({
      propertyId,
      bookingRequestId: requestId,
      paymentId,
      type: 'retained',
      status: 'completed',
      amount: '1.00',
      reason: '   ',
    })).rejects.toMatchObject({
      constraint_name: 'booking_request_payment_resolutions_retained_reason_check',
    });
  });
});
