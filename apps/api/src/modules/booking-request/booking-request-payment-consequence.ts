import { bookingRequestConsequences } from '@telivityhaip/database';

export type BookingRequestFinancialEvent =
  | 'payment.received'
  | 'payment.failed'
  | 'payment.refunded'
  | 'payment.external_returned'
  | 'payment.retained';

const kindPrefix: Record<BookingRequestFinancialEvent, string> = {
  'payment.received': 'payment_received',
  'payment.failed': 'payment_failed',
  'payment.refunded': 'payment_refunded',
  'payment.external_returned': 'external_returned',
  'payment.retained': 'payment_retained',
};

/**
 * Atomically persists a replayable financial webhook consequence.
 * `logicalId` is the durable movement/payment/resolution UUID, so an API retry
 * or Stripe delivery replay repairs a missing outbox row without duplicating it.
 */
export async function ensureBookingRequestFinancialConsequence(
  tx: any,
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
  const kind = `${kindPrefix[input.event]}:${compactLogicalId}`.slice(0, 50);
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
}
