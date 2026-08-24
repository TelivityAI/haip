export interface PaymentGatewayResult {
  success: boolean;
  transactionId: string;
  /** Provider lifecycle status when an operation can complete asynchronously. */
  providerStatus?: 'succeeded' | 'pending' | 'requires_action' | 'failed' | 'canceled' | 'unknown';
  errorMessage?: string;
}

/**
 * Optional per-call options. `idempotencyKey` is forwarded to the gateway
 * (Stripe supports `Idempotency-Key` on any mutating request) so that
 * retries of the same logical operation do not double-charge.
 */
export interface PaymentGatewayCallOptions {
  idempotencyKey?: string;
  /** Required for amount-bearing capture/refund calls outside scale-two currencies. */
  currencyCode?: string;
  /** Durable correlation identifiers forwarded to the provider on refund claims. */
  metadata?: {
    claimId: string;
    propertyId: string;
    bookingRequestId: string;
    paymentId: string;
  };
}

export interface PaymentGateway {
  authorize(
    token: string,
    amount: number,
    currency: string,
    options?: PaymentGatewayCallOptions,
  ): Promise<PaymentGatewayResult>;
  capture(
    transactionId: string,
    amount?: number,
    options?: PaymentGatewayCallOptions,
  ): Promise<PaymentGatewayResult>;
  void(
    transactionId: string,
    options?: PaymentGatewayCallOptions,
  ): Promise<PaymentGatewayResult>;
  refund(
    transactionId: string,
    amount?: number,
    options?: PaymentGatewayCallOptions,
  ): Promise<PaymentGatewayResult>;
}

export const PAYMENT_GATEWAY = Symbol('PAYMENT_GATEWAY');
