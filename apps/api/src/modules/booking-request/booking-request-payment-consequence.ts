import {
  auditLogs,
  bookingRequestConsequences,
  bookingRequestEmailDeliveries,
  bookingRequests,
} from '@telivityhaip/database';
import type { BookingRequestConsequenceKind } from '@telivityhaip/database';
import type { WebhookEvent } from '@telivityhaip/shared';
import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  failedBookingRequestPaymentEmail,
  paymentReceivedBookingRequestEmail,
  refundedBookingRequestPaymentEmail,
} from './booking-request-email.templates';

export type BookingRequestFinancialEvent =
  Extract<WebhookEvent, 'payment.received' | 'payment.failed' | 'payment.refunded'>;

const kindPrefix: Record<BookingRequestFinancialEvent, string> = {
  'payment.received': 'payment_received',
  'payment.failed': 'payment_failed',
  'payment.refunded': 'payment_refunded',
};
type FinancialConsequenceExecutor = Pick<PostgresJsDatabase, 'insert' | 'select'>;

/**
 * Atomically persists a replayable financial webhook consequence.
 * `logicalId` is the durable movement/payment/resolution UUID, so an API retry
 * or Stripe delivery replay repairs a missing outbox row without duplicating it.
 */
export async function ensureBookingRequestFinancialConsequence(
  tx: FinancialConsequenceExecutor,
  input: {
    event: BookingRequestFinancialEvent;
    logicalId: string;
    propertyId: string;
    bookingRequestId: string;
    entityType: string;
    entityId: string;
    data: Record<string, unknown>;
  },
): Promise<void> {
  const compactLogicalId = input.logicalId.replaceAll('-', '');
  const kind = `${kindPrefix[input.event]}:${compactLogicalId}`.slice(
    0,
    50,
  ) as BookingRequestConsequenceKind;
  const payload = {
    event: input.event,
    entityType: input.entityType,
    entityId: input.entityId,
    propertyId: input.propertyId,
    data: structuredClone(input.data),
    timestamp: new Date().toISOString(),
  };
  await tx
    .insert(bookingRequestConsequences)
    .values({
      propertyId: input.propertyId,
      bookingRequestId: input.bookingRequestId,
      kind,
      payload,
      status: 'pending',
      attempts: 0,
    })
    .onConflictDoNothing();
  await ensureFinancialEmail(tx, input);
}

async function ensureFinancialEmail(
  tx: FinancialConsequenceExecutor,
  input: Parameters<typeof ensureBookingRequestFinancialConsequence>[1],
): Promise<void> {
  const amount = firstString(
    input.data['amount'],
    input.data['refundAmount'],
    input.data['returnAmount'],
  );
  const currencyCode = firstString(input.data['currencyCode']);
  if (!amount || !currencyCode) return;

  const requests = await tx
    .select()
    .from(bookingRequests)
    .where(and(
      eq(bookingRequests.id, input.bookingRequestId),
      eq(bookingRequests.propertyId, input.propertyId),
    ));
  const request = requests.find((row: typeof bookingRequests.$inferSelect) =>
    row.id === input.bookingRequestId && row.propertyId === input.propertyId);
  if (!request) return;

  let kind: typeof bookingRequestEmailDeliveries.$inferInsert.kind;
  let logicalPrefix: string;
  let content: { subject: string; bodyText: string };
  if (input.event === 'payment.received') {
    kind = 'payment';
    logicalPrefix = 'payment';
    content = paymentReceivedBookingRequestEmail({
      guestFirstName: request.guestFirstName,
      amount,
      currencyCode,
      source: input.data['source'] === 'external' ? 'external' : 'saved_card',
    });
  } else if (input.event === 'payment.refunded') {
    kind = 'refund';
    logicalPrefix = 'refund';
    content = refundedBookingRequestPaymentEmail({
      guestFirstName: request.guestFirstName,
      amount,
      currencyCode,
      source: input.data['source'] === 'external_return' ? 'external_return' : 'refund',
    });
  } else {
    kind = 'failure';
    logicalPrefix = 'failure';
    content = failedBookingRequestPaymentEmail({
      guestFirstName: request.guestFirstName,
      amount,
      currencyCode,
      operation: input.data['type'] === 'refund' ? 'refund' : 'charge',
    });
  }

  const queuedAt = new Date();
  const [created] = await tx
    .insert(bookingRequestEmailDeliveries)
    .values({
      propertyId: input.propertyId,
      bookingRequestId: input.bookingRequestId,
      logicalKey: `${logicalPrefix}:${input.logicalId}`,
      kind,
      status: 'pending',
      recipient: request.guestEmail,
      subject: content.subject,
      bodyText: content.bodyText,
      attempts: 0,
      automaticAttempts: 0,
      nextAttemptAt: queuedAt,
    })
    .onConflictDoNothing()
    .returning({ id: bookingRequestEmailDeliveries.id });
  if (created) {
    await tx.insert(auditLogs).values({
      propertyId: input.propertyId,
      bookingRequestId: input.bookingRequestId,
      action: 'create',
      entityType: 'booking_request_email_delivery',
      entityId: created.id,
      description: `Booking request ${kind} email queued`,
      newValue: {
        bookingRequestId: input.bookingRequestId,
        kind,
        status: 'pending',
      },
    });
  }
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === 'string' && value.length > 0);
}
