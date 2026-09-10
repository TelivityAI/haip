/** Hosted-checkout continuation when the guest must leave HAIP to pay (Redsys TPV). */
export interface PaymentGatewayNextAction {
  type: 'redirect';
  url: string;
  method: 'POST';
  formFields: Record<string, string>;
}

export interface PaymentGatewayResult {
  success: boolean;
  transactionId: string;
  /** Provider lifecycle status when an operation can complete asynchronously. */
  providerStatus?: 'succeeded' | 'pending' | 'requires_action' | 'failed' | 'canceled' | 'unknown';
  errorMessage?: string;
  /** Present when `providerStatus` is `requires_action` (e.g. Redsys redirect). */
  nextAction?: PaymentGatewayNextAction;
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
  /** Property that owns the charge — used by per-merchant PSPs (Redsys FUC). */
  propertyId?: string;
  /** Return / notification URLs for hosted redirect authorize. */
  redirect?: {
    merchantUrl: string;
    urlOk: string;
    urlKo: string;
  };
  /** Per-property merchant credentials (overrides process env when set). */
  merchantCredentials?: {
    merchantCode: string;
    terminal: string;
    secretKey: string;
    environment?: 'test' | 'live';
  };
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
