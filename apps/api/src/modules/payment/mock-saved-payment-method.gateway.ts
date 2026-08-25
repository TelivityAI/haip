import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import type {
  SavedPaymentMethod,
  SavedPaymentMethodChargeInput,
  SavedPaymentMethodChargeResult,
  SavedPaymentMethodGateway,
  SavedPaymentMethodProvenance,
} from './interfaces/saved-payment-method-gateway.interface';

type MockSetupRecord = {
  setup: {
    setupIntentId: string;
    clientSecret: string;
    customerId: string;
    clientMode: 'mock';
  };
  paymentMethod: SavedPaymentMethod;
  propertyId: string;
  applicationHash: string;
};

type MockChargeRecord = {
  result: SavedPaymentMethodChargeResult;
  paymentId: string;
  propertyId: string;
  bookingRequestId: string;
};

@Injectable()
export class MockSavedPaymentMethodGateway implements SavedPaymentMethodGateway {
  private readonly setupsByKey = new Map<string, MockSetupRecord>();
  private readonly setupsBySetupId = new Map<string, MockSetupRecord>();
  private readonly chargesByKey = new Map<string, MockChargeRecord>();

  async createSetup(
    _email: string,
    idempotencyKey: string,
    provenance: SavedPaymentMethodProvenance,
  ): Promise<{
    setupIntentId: string;
    clientSecret: string;
    customerId: string;
    clientMode: 'mock';
  }> {
    const existing = this.setupsByKey.get(idempotencyKey);
    if (existing) {
      this.assertProvenance(existing, provenance);
      return existing.setup;
    }

    const suffix = this.stableSuffix(idempotencyKey);
    const setup = {
      setupIntentId: `seti_mock_${suffix}`,
      clientSecret: `seti_mock_${suffix}_secret_mock`,
      customerId: `cus_mock_${suffix}`,
      clientMode: 'mock' as const,
    };
    const paymentMethod: SavedPaymentMethod = {
      setupIntentId: setup.setupIntentId,
      customerId: setup.customerId,
      paymentMethodId: `pm_mock_${suffix}`,
      cardLastFour: '4242',
      cardBrand: 'visa',
    };
    const record = {
      setup,
      paymentMethod,
      propertyId: provenance.propertyId,
      applicationHash: this.stableHash(provenance.applicationId),
    };
    this.setupsByKey.set(idempotencyKey, record);
    this.setupsBySetupId.set(setup.setupIntentId, record);
    return setup;
  }

  async resolveSetup(
    setupIntentId: string,
    expectedProvenance: SavedPaymentMethodProvenance,
  ): Promise<SavedPaymentMethod> {
    const record = this.setupsBySetupId.get(setupIntentId);
    if (!record) {
      throw new Error(`Unknown mock SetupIntent '${setupIntentId}'`);
    }
    this.assertProvenance(record, expectedProvenance);
    return record.paymentMethod;
  }

  async charge(input: SavedPaymentMethodChargeInput): Promise<SavedPaymentMethodChargeResult> {
    const existing = this.chargesByKey.get(input.idempotencyKey);
    if (existing) {
      if (existing.paymentId !== input.paymentId
        || existing.propertyId !== input.propertyId
        || existing.bookingRequestId !== input.bookingRequestId) {
        throw new Error('Mock charge idempotency key was reused for a different payment identity');
      }
      return existing.result;
    }

    const result = {
      success: true,
      transactionId: `pi_mock_${this.stableSuffix(input.idempotencyKey)}`,
      requiresAction: false,
    } satisfies SavedPaymentMethodChargeResult;
    this.chargesByKey.set(input.idempotencyKey, {
      result,
      paymentId: input.paymentId,
      propertyId: input.propertyId,
      bookingRequestId: input.bookingRequestId,
    });
    return result;
  }

  private stableSuffix(value: string): string {
    return this.stableHash(value).slice(0, 24);
  }

  private stableHash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private assertProvenance(
    record: Pick<MockSetupRecord, 'propertyId' | 'applicationHash'>,
    expected: SavedPaymentMethodProvenance,
  ): void {
    if (
      record.propertyId !== expected.propertyId
      || record.applicationHash !== this.stableHash(expected.applicationId)
    ) {
      throw new Error('Mock SetupIntent provenance does not match');
    }
  }
}
