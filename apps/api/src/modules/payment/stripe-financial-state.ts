import { BadRequestException, ConflictException } from '@nestjs/common';

export type PaymentIntentEvent =
  | 'succeeded'
  | 'payment_failed'
  | 'canceled'
  | 'requires_action';

export type PaymentIntentLedgerStatus =
  | 'pending'
  | 'authorized'
  | 'captured'
  | 'failed'
  | 'voided'
  | 'settled'
  | 'partially_refunded';

type PaymentDecision = {
  action: 'transition' | 'repair' | 'unexpected';
  status: 'captured' | 'failed' | 'voided' | PaymentIntentLedgerStatus;
};

const targetStatus: Record<PaymentIntentEvent, 'captured' | 'failed' | 'voided'> = {
  succeeded: 'captured',
  payment_failed: 'failed',
  canceled: 'voided',
  requires_action: 'failed',
};

/** Pure monotonic transition policy shared by every PaymentIntent webhook. */
export function decidePaymentIntentTransition(
  current: PaymentIntentLedgerStatus,
  event: PaymentIntentEvent,
  requestStatus?: 'pending' | 'accepted' | 'denied',
): PaymentDecision {
  const target = targetStatus[event];
  if (event === 'succeeded' && requestStatus === 'denied' && current !== 'captured') {
    throw new ConflictException(
      'A captured provider payment cannot finalize after the booking request was denied',
    );
  }
  if (current === target) return { action: 'repair', status: current };
  if (current === 'pending' || (current === 'authorized' && event === 'succeeded')) {
    return { action: 'transition', status: target };
  }
  return { action: 'unexpected', status: current };
}

export type RefundProviderStatus =
  | 'succeeded'
  | 'pending'
  | 'requires_action'
  | 'failed'
  | 'canceled';

export function decideRefundTransition(
  current: 'pending' | 'completed' | 'failed',
  providerStatus: RefundProviderStatus,
) {
  const target = providerStatus === 'succeeded'
    ? 'completed' as const
    : providerStatus === 'failed' || providerStatus === 'canceled'
      ? 'failed' as const
      : 'pending' as const;
  if (current === target) {
    return {
      action: current === 'pending' ? 'record_pending' as const : 'repair' as const,
      status: current,
    };
  }
  if (current === 'pending') return { action: 'transition' as const, status: target };
  return { action: 'unexpected' as const, status: current };
}

export type RefundCorrelation = {
  claimId: string;
  propertyId: string;
  bookingRequestId: string;
  paymentId: string;
};

export function refundCorrelation(
  metadata: Record<string, string> | null | undefined,
): RefundCorrelation {
  const correlation = {
    claimId: metadata?.['haip_claim_id'],
    propertyId: metadata?.['haip_property_id'],
    bookingRequestId: metadata?.['haip_booking_request_id'],
    paymentId: metadata?.['haip_payment_id'],
  };
  if (!correlation.claimId
    || !correlation.propertyId
    || !correlation.bookingRequestId
    || !correlation.paymentId) {
    throw new BadRequestException('Stripe refund is missing exact HAIP correlation metadata');
  }
  return correlation as RefundCorrelation;
}
