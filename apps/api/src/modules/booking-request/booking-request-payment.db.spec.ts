import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { eq } from 'drizzle-orm';
import { readFileSync } from 'node:fs';
import {
  auditLogs,
  bookingRequestConsequences,
  bookingRequestEmailDeliveries,
  bookingRequestInstallments,
  bookingRequestPaymentAllocations,
  bookingRequestPaymentResolutions,
  bookingRequests,
  payments,
  properties,
  ratePlans,
  roomTypes,
} from './booking-request-db.js';
import { describe, expect, it, vi, beforeAll, afterAll } from 'vitest';
import { BookingRequestService } from './booking-request.service';
import { BookingRequestPaymentService } from './booking-request-payment.service';

const databaseUrl = process.env['PAYMENT_DB_TEST_URL'];
const describeDatabase = databaseUrl ? describe : describe.skip;
const financialRecoveryMigration = readFileSync(
  new URL('../../../../../packages/booking-requests/src/database/migrations/0025_booking_request_financial_recovery.sql', import.meta.url),
  'utf8',
);
const bookingRequestAuditRelationshipMigration = readFileSync(
  new URL('../../../../../packages/booking-requests/src/database/migrations/0029_booking_request_audit_relationship.sql', import.meta.url),
  'utf8',
);

function makeAuditService(database: unknown): BookingRequestService {
  return new BookingRequestService(
    database as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
}

describeDatabase('Booking Request PostgreSQL money and audit contract', () => {
  const propertyId = '71000000-0000-4000-a000-000000000001';
  const roomTypeId = '71000000-0000-4000-a000-000000000002';
  const ratePlanId = '71000000-0000-4000-a000-000000000003';
  const requestId = '71000000-0000-4000-a000-000000000004';
  const auditRequestId = '71000000-0000-4000-a000-000000000020';
  const paymentId = '71000000-0000-4000-a000-000000000005';
  const installmentId = '71000000-0000-4000-a000-000000000006';
  const secondPaymentId = '71000000-0000-4000-a000-000000000007';
  const secondMovementId = '71000000-0000-4000-a000-000000000008';
  const repairPaymentId = '71000000-0000-4000-a000-000000000009';
  const repairMovementId = '71000000-0000-4000-a000-000000000010';
  const repairInstallmentId = '71000000-0000-4000-a000-000000000011';
  const repairAllocationId = '71000000-0000-4000-a000-000000000012';
  const unchangedPaymentId = '71000000-0000-4000-a000-000000000013';
  const unchangedInstallmentId = '71000000-0000-4000-a000-000000000014';
  const unchangedAllocationId = '71000000-0000-4000-a000-000000000015';
  const deletedPaymentId = '71000000-0000-4000-a000-000000000016';
  const deletedMovementId = '71000000-0000-4000-a000-000000000017';
  const deletedInstallmentId = '71000000-0000-4000-a000-000000000018';
  const deletedAllocationId = '71000000-0000-4000-a000-000000000019';
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
      submittedTotal: '100.00',
      currencyCode: 'EUR',
    });
    await db.insert(bookingRequests).values({
      id: auditRequestId,
      propertyId,
      submissionIdempotencyKey: 'task-11-audit-db-contract',
      submissionFingerprint: 'c'.repeat(64),
      arrivalDate: '2026-09-03',
      departureDate: '2026-09-04',
      roomTypeId,
      ratePlanId,
      guestFirstName: 'Audit',
      guestLastName: 'Cursor',
      guestEmail: 'audit-cursor@example.com',
      submittedQuoteSnapshot: { grandTotal: '100.00' },
      submittedTotal: '100.00',
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
      submittedTotal: '100.00',
      currencyCode: 'EUR',
    });
  });

  afterAll(async () => {
    if (!client) return;
    await db.delete(bookingRequestPaymentAllocations)
      .where(eq(bookingRequestPaymentAllocations.bookingRequestId, requestId));
    await db.delete(bookingRequestConsequences)
      .where(eq(bookingRequestConsequences.bookingRequestId, requestId));
    await db.delete(bookingRequestEmailDeliveries)
      .where(eq(bookingRequestEmailDeliveries.bookingRequestId, requestId));
    await db.delete(auditLogs).where(eq(auditLogs.propertyId, propertyId));
    await db.delete(bookingRequestPaymentResolutions)
      .where(eq(bookingRequestPaymentResolutions.bookingRequestId, requestId));
    await db.delete(payments).where(eq(payments.bookingRequestId, requestId));
    await db.delete(bookingRequestInstallments)
      .where(eq(bookingRequestInstallments.bookingRequestId, requestId));
    await db.delete(bookingRequests).where(eq(bookingRequests.id, requestId));
    await db.delete(bookingRequests).where(eq(bookingRequests.id, auditRequestId));
    await db.delete(ratePlans).where(eq(ratePlans.id, ratePlanId));
    await db.delete(roomTypes).where(eq(roomTypes.id, roomTypeId));
    await db.delete(properties).where(eq(properties.id, propertyId));
    await db.delete(bookingRequests).where(eq(bookingRequests.id, otherRequestId));
    await db.delete(ratePlans).where(eq(ratePlans.id, otherRatePlanId));
    await db.delete(roomTypes).where(eq(roomTypes.id, otherRoomTypeId));
    await db.delete(properties).where(eq(properties.id, otherPropertyId));
    await client.end();
  });

  it('paginates audit rows by their durable sequence and rejects invalid cursors', async () => {
    const auditIds = [
      '71000000-0000-4000-a000-000000000021',
      '71000000-0000-4000-a000-000000000022',
      '71000000-0000-4000-a000-000000000023',
    ];
    await db.insert(auditLogs).values(auditIds.map((id) => ({
      id,
      propertyId,
      bookingRequestId: auditRequestId,
      action: 'update',
      entityType: 'booking_request',
      entityId: auditRequestId,
      newValue: { status: 'pending' },
    })));
    const insertedTimeline = await db.select({
      id: auditLogs.id,
      timelineSequence: auditLogs.timelineSequence,
    }).from(auditLogs).where(eq(auditLogs.bookingRequestId, auditRequestId));
    const sequenceById = new Map(insertedTimeline.map((row) => [
      row.id,
      row.timelineSequence.toString(),
    ]));
    const service = makeAuditService(db);

    const first = await service.auditHistory(auditRequestId, propertyId, { limit: 2 });
    const decoded = JSON.parse(Buffer.from(first.nextCursor!, 'base64url').toString('utf8'));
    const second = await service.auditHistory(auditRequestId, propertyId, {
      limit: 2,
      cursor: first.nextCursor!,
    });

    expect(first.data.map((row) => row.id)).toEqual([auditIds[2], auditIds[1]]);
    expect(decoded).toMatchObject({
      timelineSequence: sequenceById.get(auditIds[1]),
    });
    expect(Object.keys(decoded)).toEqual(['timelineSequence']);
    expect(decoded).not.toHaveProperty('occurredAt');
    expect(second.data[0]?.id).toBe(auditIds[0]);
    expect(new Set([...first.data, ...second.data].map((row) => row.id)).size)
      .toBe(first.data.length + second.data.length);

    const invalidCursor = Buffer.from(JSON.stringify({
      timelineSequence: 'not-a-sequence',
    })).toString('base64url');
    await expect(service.auditHistory(auditRequestId, propertyId, {
      limit: 2,
      cursor: invalidCursor,
    })).rejects.toMatchObject({ status: 400 });
  });

  it('backfills deleted-child audit tombstones from one unambiguous direct relationship', async () => {
    const tombstoneInstallmentId = '71000000-0000-4000-a000-000000000024';
    const tombstoneAllocationId = '71000000-0000-4000-a000-000000000025';
    const createAuditId = '71000000-0000-4000-a000-000000000026';
    const deleteAuditId = '71000000-0000-4000-a000-000000000027';
    const conflictEntityId = '71000000-0000-4000-a000-000000000028';
    const conflictAuditId = '71000000-0000-4000-a000-000000000029';
    await db.insert(bookingRequestInstallments).values({
      id: tombstoneInstallmentId,
      propertyId,
      bookingRequestId: requestId,
      label: 'Deleted audit fixture',
      fixedAmount: '1.00',
      resolvedAmount: '1.00',
      dueMilestone: 'manual',
      sortOrder: 99,
    });
    await db.insert(bookingRequestPaymentAllocations).values({
      id: tombstoneAllocationId,
      propertyId,
      bookingRequestId: requestId,
      paymentId,
      installmentId: tombstoneInstallmentId,
      amount: '1.00',
    });
    await db.insert(auditLogs).values({
      id: createAuditId,
      propertyId,
      bookingRequestId: requestId,
      action: 'create',
      entityType: 'booking_request_payment_allocation',
      entityId: tombstoneAllocationId,
      newValue: { amount: '1.00' },
      occurredAt: new Date('2099-01-01T00:00:00.002Z'),
    });
    await db.delete(bookingRequestPaymentAllocations)
      .where(eq(bookingRequestPaymentAllocations.id, tombstoneAllocationId));
    await db.insert(auditLogs).values({
      id: deleteAuditId,
      propertyId,
      bookingRequestId: null,
      action: 'delete',
      entityType: 'booking_request_payment_allocation',
      entityId: tombstoneAllocationId,
      previousValue: { amount: '1.00' },
      occurredAt: new Date('2099-01-01T00:00:00.001Z'),
    });
    await db.insert(auditLogs).values([{
      id: '71000000-0000-4000-a000-000000000030',
      propertyId,
      bookingRequestId: requestId,
      action: 'create',
      entityType: 'booking_request_payment_allocation',
      entityId: conflictEntityId,
    }, {
      id: '71000000-0000-4000-a000-000000000031',
      propertyId,
      bookingRequestId: auditRequestId,
      action: 'update',
      entityType: 'booking_request_payment_allocation',
      entityId: conflictEntityId,
    }, {
      id: conflictAuditId,
      propertyId,
      bookingRequestId: null,
      action: 'delete',
      entityType: 'booking_request_payment_allocation',
      entityId: conflictEntityId,
    }]);

    await client.unsafe(bookingRequestAuditRelationshipMigration);
    await client.unsafe(bookingRequestAuditRelationshipMigration);

    const tombstones = await db.select().from(auditLogs)
      .where(eq(auditLogs.entityId, tombstoneAllocationId));
    const [conflict] = await db.select().from(auditLogs)
      .where(eq(auditLogs.id, conflictAuditId));
    expect(tombstones).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: createAuditId, bookingRequestId: requestId }),
      expect.objectContaining({ id: deleteAuditId, bookingRequestId: requestId }),
    ]));
    expect(conflict.bookingRequestId).toBeNull();

    const service = makeAuditService(db);
    const history = await service.auditHistory(requestId, propertyId, { limit: 100 });
    expect(history.data.map((row) => row.id)).toEqual(expect.arrayContaining([
      createAuditId,
      deleteAuditId,
    ]));
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

  it('audits allocation repair once and leaves repeat/unchanged timestamps untouched', async () => {
    const originalTimestamp = new Date('2026-08-24T10:00:00.000Z');
    await db.insert(payments).values([{
      id: repairPaymentId,
      propertyId,
      bookingRequestId: requestId,
      method: 'cash',
      status: 'captured',
      amount: '100.00',
      currencyCode: 'EUR',
    }, {
      id: unchangedPaymentId,
      propertyId,
      bookingRequestId: requestId,
      method: 'cash',
      status: 'captured',
      amount: '10.00',
      currencyCode: 'EUR',
    }, {
      id: deletedPaymentId,
      propertyId,
      bookingRequestId: requestId,
      method: 'cash',
      status: 'captured',
      amount: '25.00',
      currencyCode: 'EUR',
    }]);
    await db.insert(payments).values([{
      id: repairMovementId,
      propertyId,
      bookingRequestId: requestId,
      originalPaymentId: repairPaymentId,
      method: 'cash',
      status: 'captured',
      amount: '-40.00',
      currencyCode: 'EUR',
    }, {
      id: deletedMovementId,
      propertyId,
      bookingRequestId: requestId,
      originalPaymentId: deletedPaymentId,
      method: 'cash',
      status: 'captured',
      amount: '-25.00',
      currencyCode: 'EUR',
    }]);
    await db.insert(bookingRequestInstallments).values([{
      id: repairInstallmentId,
      propertyId,
      bookingRequestId: requestId,
      label: 'Stale allocation',
      fixedAmount: '100.00',
      resolvedAmount: '100.00',
      allocatedAmount: '100.00',
      status: 'paid',
      dueMilestone: 'manual',
      updatedAt: originalTimestamp,
    }, {
      id: unchangedInstallmentId,
      propertyId,
      bookingRequestId: requestId,
      label: 'Already correct',
      fixedAmount: '10.00',
      resolvedAmount: '10.00',
      allocatedAmount: '10.00',
      status: 'paid',
      dueMilestone: 'manual',
      updatedAt: originalTimestamp,
    }, {
      id: deletedInstallmentId,
      propertyId,
      bookingRequestId: requestId,
      label: 'Fully returned allocation',
      fixedAmount: '25.00',
      resolvedAmount: '25.00',
      allocatedAmount: '25.00',
      status: 'paid',
      dueMilestone: 'manual',
      updatedAt: originalTimestamp,
    }]);
    await db.insert(bookingRequestPaymentAllocations).values([{
      id: repairAllocationId,
      propertyId,
      bookingRequestId: requestId,
      paymentId: repairPaymentId,
      installmentId: repairInstallmentId,
      amount: '100.00',
    }, {
      id: unchangedAllocationId,
      propertyId,
      bookingRequestId: requestId,
      paymentId: unchangedPaymentId,
      installmentId: unchangedInstallmentId,
      amount: '10.00',
    }, {
      id: deletedAllocationId,
      propertyId,
      bookingRequestId: requestId,
      paymentId: deletedPaymentId,
      installmentId: deletedInstallmentId,
      amount: '25.00',
    }]);

    await client.unsafe(financialRecoveryMigration);
    const [changedAfterFirst] = await db.select().from(bookingRequestInstallments)
      .where(eq(bookingRequestInstallments.id, repairInstallmentId));
    const [unchangedAfterFirst] = await db.select().from(bookingRequestInstallments)
      .where(eq(bookingRequestInstallments.id, unchangedInstallmentId));
    const [allocationAfterFirst] = await db.select().from(bookingRequestPaymentAllocations)
      .where(eq(bookingRequestPaymentAllocations.id, repairAllocationId));
    const deletedAllocationAfterFirst = await db.select().from(bookingRequestPaymentAllocations)
      .where(eq(bookingRequestPaymentAllocations.id, deletedAllocationId));
    const [deletedInstallmentAfterFirst] = await db.select().from(bookingRequestInstallments)
      .where(eq(bookingRequestInstallments.id, deletedInstallmentId));
    const auditsAfterFirst = await db.select().from(auditLogs)
      .where(eq(auditLogs.entityId, repairAllocationId));

    expect(allocationAfterFirst.amount).toBe('60.00');
    expect(deletedAllocationAfterFirst).toHaveLength(0);
    expect(deletedInstallmentAfterFirst).toMatchObject({ allocatedAmount: '0.00', status: 'unpaid' });
    expect(changedAfterFirst).toMatchObject({ allocatedAmount: '60.00', status: 'partial' });
    expect(changedAfterFirst.updatedAt.getTime()).toBeGreaterThan(originalTimestamp.getTime());
    expect(unchangedAfterFirst).toMatchObject({
      allocatedAmount: '10.00', status: 'paid', updatedAt: originalTimestamp,
    });
    expect(auditsAfterFirst).toEqual([expect.objectContaining({
      propertyId,
      action: 'update',
      entityType: 'booking_request_payment_allocation',
      entityId: repairAllocationId,
      previousValue: { amount: '100.00' },
      newValue: expect.objectContaining({
        bookingRequestId: requestId,
        paymentId: repairPaymentId,
        installmentId: repairInstallmentId,
        oldAmount: '100.00',
        newAmount: '60.00',
      }),
    })]);
    expect(await db.select().from(auditLogs)
      .where(eq(auditLogs.entityId, deletedAllocationId))).toEqual([
      expect.objectContaining({
        propertyId,
        action: 'delete',
        entityType: 'booking_request_payment_allocation',
        previousValue: { amount: '25.00' },
        newValue: expect.objectContaining({
          bookingRequestId: requestId,
          paymentId: deletedPaymentId,
          installmentId: deletedInstallmentId,
          oldAmount: '25.00',
          newAmount: '0.00',
        }),
      }),
    ]);
    expect(await db.select().from(auditLogs)
      .where(eq(auditLogs.entityId, repairInstallmentId))).toEqual([
      expect.objectContaining({
        propertyId,
        action: 'update',
        entityType: 'booking_request_installment',
        previousValue: { allocatedAmount: '100.00', status: 'paid' },
        newValue: expect.objectContaining({
          bookingRequestId: requestId,
          oldAllocatedAmount: '100.00',
          newAllocatedAmount: '60.00',
          oldStatus: 'paid',
          newStatus: 'partial',
        }),
      }),
    ]);
    expect(await db.select().from(auditLogs)
      .where(eq(auditLogs.entityId, deletedInstallmentId))).toEqual([
      expect.objectContaining({
        propertyId,
        action: 'update',
        entityType: 'booking_request_installment',
        previousValue: { allocatedAmount: '25.00', status: 'paid' },
        newValue: expect.objectContaining({
          bookingRequestId: requestId,
          oldAllocatedAmount: '25.00',
          newAllocatedAmount: '0.00',
          oldStatus: 'paid',
          newStatus: 'unpaid',
        }),
      }),
    ]);

    const changedTimestamp = changedAfterFirst.updatedAt.getTime();
    const deletedTimestamp = deletedInstallmentAfterFirst.updatedAt.getTime();
    await client.unsafe(financialRecoveryMigration);
    const [changedAfterReplay] = await db.select().from(bookingRequestInstallments)
      .where(eq(bookingRequestInstallments.id, repairInstallmentId));
    const [unchangedAfterReplay] = await db.select().from(bookingRequestInstallments)
      .where(eq(bookingRequestInstallments.id, unchangedInstallmentId));
    const auditsAfterReplay = await db.select().from(auditLogs)
      .where(eq(auditLogs.entityId, repairAllocationId));
    const [deletedInstallmentAfterReplay] = await db.select().from(bookingRequestInstallments)
      .where(eq(bookingRequestInstallments.id, deletedInstallmentId));

    expect(changedAfterReplay.updatedAt.getTime()).toBe(changedTimestamp);
    expect(unchangedAfterReplay.updatedAt.getTime()).toBe(originalTimestamp.getTime());
    expect(deletedInstallmentAfterReplay.updatedAt.getTime()).toBe(deletedTimestamp);
    expect(auditsAfterReplay).toHaveLength(1);
    expect(await db.select().from(auditLogs)
      .where(eq(auditLogs.entityId, deletedAllocationId))).toHaveLength(1);
    expect(await db.select().from(auditLogs)
      .where(eq(auditLogs.entityId, repairInstallmentId))).toHaveLength(1);
    expect(await db.select().from(auditLogs)
      .where(eq(auditLogs.entityId, deletedInstallmentId))).toHaveLength(1);
    expect(await db.select().from(auditLogs)
      .where(eq(auditLogs.entityId, unchangedAllocationId))).toHaveLength(0);
    expect(await db.select().from(auditLogs)
      .where(eq(auditLogs.entityId, unchangedInstallmentId))).toHaveLength(0);

    const runtimeResetTimestamp = new Date('2026-08-24T19:00:00.000Z');
    await db.update(bookingRequestPaymentAllocations)
      .set({ amount: '100.00' })
      .where(eq(bookingRequestPaymentAllocations.id, repairAllocationId));
    await db.update(bookingRequestInstallments)
      .set({ allocatedAmount: '100.00', status: 'paid', updatedAt: runtimeResetTimestamp })
      .where(eq(bookingRequestInstallments.id, repairInstallmentId));

    await client.unsafe(financialRecoveryMigration);
    const [repairedAgainAllocation] = await db.select().from(bookingRequestPaymentAllocations)
      .where(eq(bookingRequestPaymentAllocations.id, repairAllocationId));
    const [repairedAgainInstallment] = await db.select().from(bookingRequestInstallments)
      .where(eq(bookingRequestInstallments.id, repairInstallmentId));
    expect(repairedAgainAllocation.amount).toBe('60.00');
    expect(repairedAgainInstallment).toMatchObject({ allocatedAmount: '60.00', status: 'partial' });
    expect(await db.select().from(auditLogs)
      .where(eq(auditLogs.entityId, repairAllocationId))).toHaveLength(2);
    expect(await db.select().from(auditLogs)
      .where(eq(auditLogs.entityId, repairInstallmentId))).toHaveLength(2);

    const secondRepairTimestamp = repairedAgainInstallment.updatedAt.getTime();
    await client.unsafe(financialRecoveryMigration);
    const [immediateReplayInstallment] = await db.select().from(bookingRequestInstallments)
      .where(eq(bookingRequestInstallments.id, repairInstallmentId));
    expect(immediateReplayInstallment.updatedAt.getTime()).toBe(secondRepairTimestamp);
    expect(await db.select().from(auditLogs)
      .where(eq(auditLogs.entityId, repairAllocationId))).toHaveLength(2);
    expect(await db.select().from(auditLogs)
      .where(eq(auditLogs.entityId, repairInstallmentId))).toHaveLength(2);

    const runtimeTimestamp = new Date('2026-08-24T20:00:00.000Z');
    const runtimeClient = postgres(databaseUrl!, { max: 1 });
    let markLocked!: () => void;
    let releaseRuntime!: () => void;
    const runtimeLocked = new Promise<void>((resolve) => { markLocked = resolve; });
    const release = new Promise<void>((resolve) => { releaseRuntime = resolve; });
    const runtimeReduction = runtimeClient.begin(async (sql) => {
      await sql.unsafe(
        'SELECT id FROM payments WHERE id = $1 ORDER BY id FOR UPDATE',
        [repairPaymentId],
      );
      await sql.unsafe(
        'UPDATE booking_request_installments SET allocated_amount = $1, status = $2, updated_at = $3 WHERE id = $4',
        ['30.00', 'partial', runtimeTimestamp, repairInstallmentId],
      );
      await sql.unsafe(
        'UPDATE booking_request_payment_allocations SET amount = $1 WHERE id = $2',
        ['30.00', repairAllocationId],
      );
      markLocked();
      await release;
    });
    await runtimeLocked;
    let migrationSettled = false;
    const concurrentRepair = client.unsafe(financialRecoveryMigration)
      .finally(() => { migrationSettled = true; });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(migrationSettled).toBe(false);
    releaseRuntime();
    await Promise.all([runtimeReduction, concurrentRepair]);
    await runtimeClient.end();

    const [allocationAfterRace] = await db.select().from(bookingRequestPaymentAllocations)
      .where(eq(bookingRequestPaymentAllocations.id, repairAllocationId));
    const [installmentAfterRace] = await db.select().from(bookingRequestInstallments)
      .where(eq(bookingRequestInstallments.id, repairInstallmentId));
    expect(allocationAfterRace.amount).toBe('30.00');
    expect(installmentAfterRace).toMatchObject({
      allocatedAmount: '30.00',
      status: 'partial',
      updatedAt: runtimeTimestamp,
    });
    expect(await db.select().from(auditLogs)
      .where(eq(auditLogs.entityId, repairAllocationId))).toHaveLength(2);
    expect(await db.select().from(auditLogs)
      .where(eq(auditLogs.entityId, repairInstallmentId))).toHaveLength(2);
  });
});
