export interface PaymentGatewayResult {
  success: boolean;
  transactionId: string;
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
