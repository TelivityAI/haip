import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { eq } from 'drizzle-orm';
import {
  auditLogs,
  bookingRequestConsequences,
  bookingRequestInstallments,
  bookingRequestPaymentAllocations,
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
  const installmentId = '71000000-0000-4000-a000-000000000006';
  const secondPaymentId = '71000000-0000-4000-a000-000000000007';
  const secondMovementId = '71000000-0000-4000-a000-000000000008';
  const otherPropertyId = '72000000-0000-4000-a000-000000000001';
  const otherRoomTypeId = '72000000-0000-4000-a000-000000000002';
  const otherRatePlanId = '72000000-0000-4000-a000-000000000003';
  const otherRequestId = '72000000-0000-4000-a000-000000000004';
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
    await db.insert(properties).values({
      id: otherPropertyId,
      name: 'Task 7 other property',
      code: 'TASK7OTHER',
      countryCode: 'ES',
      timezone: 'Europe/Madrid',
      currencyCode: 'EUR',
      totalRooms: 1,
    });
    await db.insert(roomTypes).values({
      id: otherRoomTypeId,
      propertyId: otherPropertyId,
      name: 'Other room',
      code: 'OTHER',
      maxOccupancy: 2,
      defaultOccupancy: 2,
    });
    await db.insert(ratePlans).values({
      id: otherRatePlanId,
      propertyId: otherPropertyId,
      roomTypeId: otherRoomTypeId,
      name: 'Other rate',
      code: 'OTHER',
      type: 'bar',
      baseAmount: '100.00',
      currencyCode: 'EUR',
    });
    await db.insert(bookingRequests).values({
      id: otherRequestId,
      propertyId: otherPropertyId,
      submissionIdempotencyKey: 'task-7-other-request',
      submissionFingerprint: 'b'.repeat(64),
      arrivalDate: '2026-09-01',
      departureDate: '2026-09-02',
      roomTypeId: otherRoomTypeId,
      ratePlanId: otherRatePlanId,
      guestFirstName: 'Other',
      guestLastName: 'Property',
      guestEmail: 'other@example.com',
      submittedQuoteSnapshot: { grandTotal: '100.00' },
      currencyCode: 'EUR',
    });
  });

  afterAll(async () => {
    if (!client) return;
    await db.delete(bookingRequestPaymentAllocations)
      .where(eq(bookingRequestPaymentAllocations.bookingRequestId, requestId));
    await db.delete(bookingRequestConsequences)
      .where(eq(bookingRequestConsequences.bookingRequestId, requestId));
    await db.delete(auditLogs).where(eq(auditLogs.propertyId, propertyId));
    await db.delete(bookingRequestPaymentResolutions)
      .where(eq(bookingRequestPaymentResolutions.bookingRequestId, requestId));
    await db.delete(payments).where(eq(payments.bookingRequestId, requestId));
    await db.delete(bookingRequestInstallments)
      .where(eq(bookingRequestInstallments.bookingRequestId, requestId));
    await db.delete(bookingRequests).where(eq(bookingRequests.id, requestId));
    await db.delete(ratePlans).where(eq(ratePlans.id, ratePlanId));
    await db.delete(roomTypes).where(eq(roomTypes.id, roomTypeId));
    await db.delete(properties).where(eq(properties.id, propertyId));
    await db.delete(bookingRequests).where(eq(bookingRequests.id, otherRequestId));
    await db.delete(ratePlans).where(eq(ratePlans.id, otherRatePlanId));
    await db.delete(roomTypes).where(eq(roomTypes.id, otherRoomTypeId));
    await db.delete(properties).where(eq(properties.id, otherPropertyId));
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
      resolvedAt: new Date(),
    })).rejects.toMatchObject({
      constraint_name: 'booking_request_payment_resolutions_retained_reason_check',
    });
  });

  it('enforces request/property ownership, refund child shape, and resolution lifecycle', async () => {
    await expect(db.insert(payments).values({
      propertyId,
      bookingRequestId: otherRequestId,
      method: 'cash',
      status: 'captured',
      amount: '10.00',
      currencyCode: 'EUR',
    })).rejects.toMatchObject({ constraint_name: 'payments_booking_request_fkey' });

    await expect(db.insert(bookingRequestInstallments).values({
      propertyId,
      bookingRequestId: otherRequestId,
      label: 'Wrong owner',
      fixedAmount: '10.00',
      resolvedAmount: '10.00',
      dueMilestone: 'manual',
    })).rejects.toMatchObject({ constraint_name: 'booking_request_installments_request_fkey' });

    await expect(db.insert(payments).values({
      propertyId: otherPropertyId,
      bookingRequestId: otherRequestId,
      originalPaymentId: paymentId,
      method: 'credit_card',
      status: 'captured',
      amount: '-10.00',
      currencyCode: 'EUR',
    })).rejects.toMatchObject({ constraint_name: 'payments_booking_request_parent_fkey' });

    await expect(db.insert(payments).values({
      propertyId,
      bookingRequestId: requestId,
      originalPaymentId: paymentId,
      method: 'credit_card',
      status: 'pending',
      amount: '10.00',
      currencyCode: 'EUR',
    })).rejects.toMatchObject({ constraint_name: 'payments_booking_request_child_shape_check' });

    await expect(db.insert(bookingRequestPaymentResolutions).values({
      propertyId,
      bookingRequestId: requestId,
      paymentId,
      type: 'refund',
      status: 'completed',
      amount: '1.00',
      resolvedAt: new Date(),
    })).rejects.toMatchObject({
      constraint_name: 'booking_request_payment_resolutions_lifecycle_check',
    });

    await expect(db.insert(bookingRequestPaymentResolutions).values({
      propertyId,
      bookingRequestId: requestId,
      paymentId,
      type: 'retained',
      status: 'pending',
      amount: '1.00',
      reason: 'Pending retention is invalid',
    })).rejects.toMatchObject({
      constraint_name: 'booking_request_payment_resolutions_lifecycle_check',
    });
  });

  it('rejects cross-scope consequence/allocation rows and movements from another parent', async () => {
    await expect(db.insert(bookingRequestConsequences).values({
      propertyId,
      bookingRequestId: otherRequestId,
      kind: 'payment_received:cross-scope',
      payload: {},
    })).rejects.toMatchObject({
      constraint_name: 'booking_request_consequences_request_fkey',
    });

    await db.insert(bookingRequestInstallments).values({
      id: installmentId,
      propertyId,
      bookingRequestId: requestId,
      label: 'Ownership fixture',
      fixedAmount: '10.00',
      resolvedAmount: '10.00',
      dueMilestone: 'manual',
    });
    await expect(db.insert(bookingRequestPaymentAllocations).values({
      propertyId: otherPropertyId,
      bookingRequestId: otherRequestId,
      paymentId,
      installmentId,
      amount: '1.00',
    })).rejects.toMatchObject({
      constraint_name: 'booking_request_payment_allocations_payment_fkey',
    });

    await db.insert(payments).values({
      id: secondPaymentId,
      propertyId,
      bookingRequestId: requestId,
      method: 'cash',
      status: 'captured',
      amount: '20.00',
      currencyCode: 'EUR',
      processedAt: new Date(),
    });
    await db.insert(payments).values({
      id: secondMovementId,
      propertyId,
      bookingRequestId: requestId,
      originalPaymentId: secondPaymentId,
      method: 'cash',
      status: 'captured',
      amount: '-5.00',
      currencyCode: 'EUR',
      processedAt: new Date(),
    });
    await expect(db.insert(bookingRequestPaymentResolutions).values({
      propertyId,
      bookingRequestId: requestId,
      paymentId,
      type: 'external_return',
      status: 'completed',
      amount: '5.00',
      movementId: secondMovementId,
      reason: 'Movement belongs to a different parent',
      resolvedAt: new Date(),
    })).rejects.toMatchObject({
      constraint_name: 'booking_request_payment_resolutions_parent_movement_fkey',
    });
  });
});
