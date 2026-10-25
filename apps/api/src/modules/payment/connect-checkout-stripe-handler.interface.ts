import type Stripe from 'stripe';

export const CONNECT_CHECKOUT_STRIPE_HANDLER = Symbol('CONNECT_CHECKOUT_STRIPE_HANDLER');

export interface ConnectCheckoutStripeHandler {
  handleCheckoutSessionCompleted(
    eventId: string,
    session: Stripe.Checkout.Session,
  ): Promise<unknown>;
}
