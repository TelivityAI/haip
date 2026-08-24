import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import type {
  SavedPaymentMethod,
  SavedPaymentMethodChargeInput,
  SavedPaymentMethodChargeResult,
  SavedPaymentMethodGateway,
} from './interfaces/saved-payment-method-gateway.interface';

@Injectable()
export class MockSavedPaymentMethodGateway implements SavedPaymentMethodGateway {
  private readonly setupsByKey = new Map<string, {
    setup: { setupIntentId: string; clientSecret: string; customerId: string };
    paymentMethod: SavedPaymentMethod;
  }>();
  private readonly paymentMethodsBySetupId = new Map<string, SavedPaymentMethod>();
  private readonly chargesByKey = new Map<string, SavedPaymentMethodChargeResult>();

  async createSetup(_email: string, idempotencyKey: string): Promise<{
    setupIntentId: string;
    clientSecret: string;
    customerId: string;
  }> {
    const existing = this.setupsByKey.get(idempotencyKey);
    if (existing) return existing.setup;

    const suffix = this.stableSuffix(idempotencyKey);
    const setup = {
      setupIntentId: `seti_mock_${suffix}`,
      clientSecret: `seti_mock_${suffix}_secret_mock`,
      customerId: `cus_mock_${suffix}`,
    };
    const paymentMethod: SavedPaymentMethod = {
      setupIntentId: setup.setupIntentId,
      customerId: setup.customerId,
      paymentMethodId: `pm_mock_${suffix}`,
      cardLastFour: '4242',
      cardBrand: 'visa',
    };
    this.setupsByKey.set(idempotencyKey, { setup, paymentMethod });
    this.paymentMethodsBySetupId.set(setup.setupIntentId, paymentMethod);
    return setup;
  }

  async resolveSetup(setupIntentId: string): Promise<SavedPaymentMethod> {
    const paymentMethod = this.paymentMethodsBySetupId.get(setupIntentId);
    if (!paymentMethod) {
      throw new Error(`Unknown mock SetupIntent '${setupIntentId}'`);
    }
    return paymentMethod;
  }

  async charge(input: SavedPaymentMethodChargeInput): Promise<SavedPaymentMethodChargeResult> {
    const existing = this.chargesByKey.get(input.idempotencyKey);
    if (existing) return existing;

    const result = {
      success: true,
      transactionId: `pi_mock_${this.stableSuffix(input.idempotencyKey)}`,
      requiresAction: false,
    } satisfies SavedPaymentMethodChargeResult;
    this.chargesByKey.set(input.idempotencyKey, result);
    return result;
  }

  private stableSuffix(value: string): string {
    return createHash('sha256').update(value).digest('hex').slice(0, 24);
  }
}
