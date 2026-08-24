import { Injectable } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import Decimal from 'decimal.js';
import Stripe from 'stripe';
import type {
  SavedPaymentMethod,
  SavedPaymentMethodChargeInput,
  SavedPaymentMethodChargeResult,
  SavedPaymentMethodGateway,
} from './interfaces/saved-payment-method-gateway.interface';

@Injectable()
export class StripeSavedPaymentMethodGateway implements SavedPaymentMethodGateway {
  private readonly stripe: Stripe;

  constructor(configService: ConfigService) {
    const secretKey = configService.get<string>('STRIPE_SECRET_KEY');
    if (!secretKey) {
      throw new Error(
        'STRIPE_SECRET_KEY is required for saved Stripe payment methods. ' +
        'Set STRIPE_MODE=mock for development without Stripe keys.',
      );
    }

    this.stripe = new Stripe(secretKey, {
      apiVersion: '2025-03-31.basil',
      typescript: true,
    });
  }

  async createSetup(email: string, idempotencyKey: string): Promise<{
    setupIntentId: string;
    clientSecret: string;
    customerId: string;
  }> {
    const options: Stripe.RequestOptions = { idempotencyKey };
    const customer = await this.stripe.customers.create({ email }, options);
    const setupIntent = await this.stripe.setupIntents.create(
      {
        customer: customer.id,
        usage: 'off_session',
        payment_method_types: ['card'],
      },
      options,
    );

    if (!setupIntent.client_secret) {
      throw new Error(`Stripe SetupIntent '${setupIntent.id}' has no client secret`);
    }

    return {
      setupIntentId: setupIntent.id,
      clientSecret: setupIntent.client_secret,
      customerId: customer.id,
    };
  }

  async resolveSetup(setupIntentId: string): Promise<SavedPaymentMethod> {
    const setupIntent = await this.stripe.setupIntents.retrieve(setupIntentId);
    if (setupIntent.status !== 'succeeded') {
      throw new Error(`Stripe SetupIntent '${setupIntentId}' has not succeeded`);
    }

    const customerId = this.expandedId(setupIntent.customer);
    const paymentMethodId = this.expandedId(setupIntent.payment_method);
    if (!customerId || !paymentMethodId) {
      throw new Error(`Stripe SetupIntent '${setupIntentId}' is missing saved payment references`);
    }

    const paymentMethod = await this.stripe.paymentMethods.retrieve(paymentMethodId);
    const attachedCustomerId = this.expandedId(paymentMethod.customer);
    if (attachedCustomerId !== customerId) {
      throw new Error(
        `Stripe PaymentMethod '${paymentMethod.id}' does not belong to ` +
        `SetupIntent customer '${customerId}'`,
      );
    }
    if (paymentMethod.type !== 'card' || !paymentMethod.card) {
      throw new Error(`Stripe SetupIntent '${setupIntentId}' did not save a card payment method`);
    }

    return {
      setupIntentId: setupIntent.id,
      customerId,
      paymentMethodId: paymentMethod.id,
      cardLastFour: paymentMethod.card.last4,
      cardBrand: paymentMethod.card.brand,
    };
  }

  async charge(input: SavedPaymentMethodChargeInput): Promise<SavedPaymentMethodChargeResult> {
    try {
      const currencyCode = this.normalizeCurrencyCode(input.currencyCode);
      const paymentIntent = await this.stripe.paymentIntents.create(
        {
          amount: this.toMinorUnits(input.amount, currencyCode),
          currency: currencyCode.toLowerCase(),
          customer: input.customerId,
          payment_method: input.paymentMethodId,
          confirm: true,
          off_session: true,
          capture_method: 'automatic',
          automatic_payment_methods: {
            enabled: true,
            allow_redirects: 'never',
          },
        },
        { idempotencyKey: input.idempotencyKey },
      );

      return this.mapPaymentIntent(paymentIntent);
    } catch (error: unknown) {
      const stripePaymentIntent = this.paymentIntentFromError(error);
      if (stripePaymentIntent?.status === 'requires_action') {
        return this.requiresAction(stripePaymentIntent.id);
      }

      return {
        success: false,
        transactionId: stripePaymentIntent?.id ?? '',
        requiresAction: false,
        errorMessage: error instanceof Error ? error.message : 'Stripe charge failed',
      };
    }
  }

  private expandedId(value: string | { id: string } | null): string | null {
    return typeof value === 'string' ? value : value?.id ?? null;
  }

  private normalizeCurrencyCode(currencyCode: string): string {
    const normalized = currencyCode.trim().toUpperCase();
    const intlWithSupportedValues = Intl as typeof Intl & {
      supportedValuesOf?: (key: 'currency') => string[];
    };
    if (
      !intlWithSupportedValues.supportedValuesOf ||
      !intlWithSupportedValues.supportedValuesOf('currency').includes(normalized)
    ) {
      throw new Error(`Unsupported ISO-4217 currency code '${currencyCode}'`);
    }
    return normalized;
  }

  private toMinorUnits(amount: string, currencyCode: string): number {
    const exponent = new Intl.NumberFormat('en', {
      style: 'currency',
      currency: currencyCode,
    }).resolvedOptions().maximumFractionDigits;
    if (exponent === undefined) {
      throw new Error(`Unable to resolve minor-unit exponent for '${currencyCode}'`);
    }
    const minorUnits = new Decimal(amount).mul(new Decimal(10).pow(exponent));
    if (!minorUnits.isInteger()) {
      throw new Error(`Amount '${amount}' ${currencyCode} has fractional minor units`);
    }
    const value = minorUnits.toNumber();
    if (!Number.isSafeInteger(value)) {
      throw new Error(`Amount '${amount}' ${currencyCode} exceeds the safe Stripe integer range`);
    }
    return value;
  }

  private mapPaymentIntent(paymentIntent: Stripe.PaymentIntent): SavedPaymentMethodChargeResult {
    if (paymentIntent.status === 'succeeded') {
      return {
        success: true,
        transactionId: paymentIntent.id,
        requiresAction: false,
      };
    }
    if (paymentIntent.status === 'requires_action') {
      return this.requiresAction(paymentIntent.id);
    }
    return {
      success: false,
      transactionId: paymentIntent.id,
      requiresAction: false,
      errorMessage: `Unexpected Stripe PaymentIntent status: ${paymentIntent.status}`,
    };
  }

  private requiresAction(transactionId: string): SavedPaymentMethodChargeResult {
    return {
      success: false,
      transactionId,
      requiresAction: true,
      errorMessage: 'Payment requires additional authentication',
    };
  }

  private paymentIntentFromError(error: unknown): Stripe.PaymentIntent | undefined {
    if (typeof error !== 'object' || error === null || !('payment_intent' in error)) {
      return undefined;
    }
    const paymentIntent = error.payment_intent;
    return typeof paymentIntent === 'object' && paymentIntent !== null && 'id' in paymentIntent
      ? paymentIntent as Stripe.PaymentIntent
      : undefined;
  }
}
