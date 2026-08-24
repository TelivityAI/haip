export type SavedPaymentMethod = {
  setupIntentId: string;
  customerId: string;
  paymentMethodId: string;
  cardLastFour: string;
  cardBrand: string;
};

export type SavedPaymentMethodChargeInput = {
  customerId: string;
  paymentMethodId: string;
  amount: string;
  currencyCode: string;
  idempotencyKey: string;
};

export type SavedPaymentMethodChargeResult = {
  success: boolean;
  transactionId: string;
  requiresAction: boolean;
  errorMessage?: string;
};

export interface SavedPaymentMethodGateway {
  createSetup(email: string, idempotencyKey: string): Promise<{
    setupIntentId: string;
    clientSecret: string;
    customerId: string;
  }>;
  resolveSetup(setupIntentId: string): Promise<SavedPaymentMethod>;
  charge(input: SavedPaymentMethodChargeInput): Promise<SavedPaymentMethodChargeResult>;
}

export const SAVED_PAYMENT_METHOD_GATEWAY = Symbol('SAVED_PAYMENT_METHOD_GATEWAY');
