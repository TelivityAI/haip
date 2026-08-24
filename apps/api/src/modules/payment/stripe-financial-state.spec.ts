import { ConflictException } from '@nestjs/common';
import {
  decidePaymentIntentTransition,
  decideRefundTransition,
  refundCorrelation,
} from './stripe-financial-state';

describe('Stripe financial webhook state', () => {
  it.each([
    ['succeeded', 'captured'],
    ['payment_failed', 'failed'],
    ['canceled', 'voided'],
    ['requires_action', 'failed'],
  ] as const)('moves a pending PaymentIntent %s to %s', (event, expected) => {
    expect(decidePaymentIntentTransition('pending', event, 'pending')).toEqual({
      action: 'transition',
      status: expected,
    });
  });

  it.each(['failed', 'voided'] as const)(
    'never captures a terminal %s payment from a late success',
    (current) => {
      expect(decidePaymentIntentTransition(current, 'succeeded', 'pending')).toEqual({
        action: 'unexpected',
        status: current,
      });
    },
  );

  it('repairs a replay of the same terminal PaymentIntent result', () => {
    expect(decidePaymentIntentTransition('captured', 'succeeded', 'accepted')).toEqual({
      action: 'repair',
      status: 'captured',
    });
    expect(decidePaymentIntentTransition('failed', 'payment_failed', 'pending')).toEqual({
      action: 'repair',
      status: 'failed',
    });
  });

  it('blocks capture finalization once the booking request is denied', () => {
    expect(() => decidePaymentIntentTransition('pending', 'succeeded', 'denied'))
      .toThrow(ConflictException);
  });

  it.each([
    ['succeeded', 'completed'],
    ['failed', 'failed'],
    ['canceled', 'failed'],
    ['pending', 'pending'],
    ['requires_action', 'pending'],
  ] as const)('maps a pending refund %s monotonically to %s', (provider, expected) => {
    expect(decideRefundTransition('pending', provider)).toEqual({
      action: provider === 'pending' || provider === 'requires_action'
        ? 'record_pending'
        : 'transition',
      status: expected,
    });
  });

  it('does not regress completed or failed refund claims on out-of-order events', () => {
    expect(decideRefundTransition('completed', 'failed')).toEqual({
      action: 'unexpected',
      status: 'completed',
    });
    expect(decideRefundTransition('failed', 'succeeded')).toEqual({
      action: 'unexpected',
      status: 'failed',
    });
    expect(decideRefundTransition('completed', 'succeeded')).toEqual({
      action: 'repair',
      status: 'completed',
    });
  });

  it('requires exact claim-scoped Stripe refund metadata', () => {
    expect(refundCorrelation({
      haip_claim_id: 'claim-2',
      haip_property_id: 'property-1',
      haip_booking_request_id: 'request-1',
      haip_payment_id: 'payment-1',
    })).toEqual({
      claimId: 'claim-2',
      propertyId: 'property-1',
      bookingRequestId: 'request-1',
      paymentId: 'payment-1',
    });
    expect(() => refundCorrelation({ haip_claim_id: 'claim-2' }))
      .toThrow(/correlation metadata/i);
  });
});
