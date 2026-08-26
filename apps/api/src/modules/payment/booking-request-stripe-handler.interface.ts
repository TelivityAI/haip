import type Stripe from 'stripe';

/** Injection token for optional booking-request Stripe webhook handling. */
export const BOOKING_REQUEST_STRIPE_HANDLER = Symbol('BOOKING_REQUEST_STRIPE_HANDLER');

export type BookingRequestStripePaymentRow = {
  id: string;
  propertyId: string;
  folioId: string | null;
  bookingRequestId?: string | null;
  status: string;
  amount: string;
  currencyCode: string;
  method: string;
  gatewayProvider: string | null;
  gatewayTransactionId: string | null;
  originalPaymentId?: string | null;
};

/**
 * Optional handler registered by @telivityhaip/booking-requests when
 * HAIP_BOOKING_REQUESTS=true. Core Stripe webhook delegates here when
 * payment.bookingRequestId is set.
 */
export interface BookingRequestStripeHandler {
  handlePaymentIntentSucceeded(
    pi: Stripe.PaymentIntent,
    payment: BookingRequestStripePaymentRow,
  ): Promise<void>;

  handlePaymentIntentFailed(
    pi: Stripe.PaymentIntent,
    payment: BookingRequestStripePaymentRow,
  ): Promise<void>;

  handlePaymentIntentCanceled(
    pi: Stripe.PaymentIntent,
    payment: BookingRequestStripePaymentRow,
  ): Promise<void>;

  handlePaymentIntentProcessing(
    pi: Stripe.PaymentIntent,
    payment: BookingRequestStripePaymentRow,
  ): Promise<void>;

  handlePaymentIntentRequiresAction(
    pi: Stripe.PaymentIntent,
    payment: BookingRequestStripePaymentRow,
  ): Promise<void>;

  handleChargeRefunded(
    charge: Stripe.Charge,
    payment: BookingRequestStripePaymentRow,
  ): Promise<void>;

  handleRefundUpdated(refund: Stripe.Refund): Promise<void>;
}

export function paymentHasBookingRequestId(
  payment: BookingRequestStripePaymentRow,
): payment is BookingRequestStripePaymentRow & { bookingRequestId: string } {
  return typeof payment.bookingRequestId === 'string' && payment.bookingRequestId.length > 0;
}

export function isBookingRequestsEnabled(): boolean {
  return process.env['HAIP_BOOKING_REQUESTS'] === 'true';
}
