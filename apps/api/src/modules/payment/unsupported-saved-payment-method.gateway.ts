import type {
  SavedPaymentMethod,
  SavedPaymentMethodChargeInput,
  SavedPaymentMethodChargeResult,
  SavedPaymentMethodGateway,
  SavedPaymentMethodProvenance,
} from './interfaces/saved-payment-method-gateway.interface';
import type { PaymentGatewayProvider } from './payment-gateway.factory';

export class UnsupportedSavedPaymentMethodGateway implements SavedPaymentMethodGateway {
  constructor(private readonly provider: Exclude<PaymentGatewayProvider, 'mock' | 'stripe'>) {}

  async createSetup(
    _email: string,
    _idempotencyKey: string,
    _provenance: SavedPaymentMethodProvenance,
  ): Promise<{
    setupIntentId: string;
    clientSecret: string;
    customerId: string;
    clientMode: 'mock' | 'stripe';
  }> {
    throw this.unsupported();
  }

  async resolveSetup(
    _setupIntentId: string,
    _expectedProvenance: SavedPaymentMethodProvenance,
  ): Promise<SavedPaymentMethod> {
    throw this.unsupported();
  }

  async charge(_input: SavedPaymentMethodChargeInput): Promise<SavedPaymentMethodChargeResult> {
    throw this.unsupported();
  }

  private unsupported(): Error {
    return new Error(
      `Saved payment methods are not supported when PAYMENT_GATEWAY='${this.provider}'. ` +
      `Configure PAYMENT_GATEWAY='stripe' to use this capability.`,
    );
  }
}
