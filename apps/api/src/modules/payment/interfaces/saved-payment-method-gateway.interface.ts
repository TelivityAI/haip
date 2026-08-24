export type SavedPaymentMethod = {
  setupIntentId: string;
  customerId: string;
  paymentMethodId: string;
  cardLastFour: string;
  cardBrand: string;
};

export type SavedPaymentMethodProvenance = {
  propertyId: string;
  applicationId: string;
};

export type SavedPaymentMethodChargeInput = {
  customerId: string;
  paymentMethodId: string;
  /** Durable HAIP identities used by signed provider webhooks for crash recovery. */
  paymentId: string;
  propertyId: string;
  bookingRequestId: string;
  amount: string;
  currencyCode: string;
  idempotencyKey: string;
};

export type SavedPaymentMethodChargeResult = {
  success: boolean;
  transactionId: string;
  requiresAction: boolean;
  /** The provider accepted the request but has not reported a terminal result. */
  indeterminate?: boolean;
  providerStatus?: string;
  errorMessage?: string;
};

export interface SavedPaymentMethodGateway {
  createSetup(
    email: string,
    idempotencyKey: string,
    provenance: SavedPaymentMethodProvenance,
  ): Promise<{
    setupIntentId: string;
    clientSecret: string;
    customerId: string;
  }>;
  resolveSetup(
    setupIntentId: string,
    expectedProvenance: SavedPaymentMethodProvenance,
  ): Promise<SavedPaymentMethod>;
  charge(input: SavedPaymentMethodChargeInput): Promise<SavedPaymentMethodChargeResult>;
}

export const SAVED_PAYMENT_METHOD_GATEWAY = Symbol('SAVED_PAYMENT_METHOD_GATEWAY');
