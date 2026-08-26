import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { FolioModule } from '../folio/folio.module';
import { WebhookModule } from '../webhook/webhook.module';
import { PaymentController } from './payment.controller';
import { StripeWebhookController } from './stripe-webhook.controller';
import { PaymentService } from './payment.service';
import { PAYMENT_GATEWAY } from './interfaces/payment-gateway.interface';
import {
  createPaymentGateway,
  resolvePaymentGatewayProvider,
} from './payment-gateway.factory';
import { SAVED_PAYMENT_METHOD_GATEWAY } from './interfaces/saved-payment-method-gateway.interface';
import { MockSavedPaymentMethodGateway } from './mock-saved-payment-method.gateway';
import { StripeSavedPaymentMethodGateway } from './stripe-saved-payment-method.gateway';
import { UnsupportedSavedPaymentMethodGateway } from './unsupported-saved-payment-method.gateway';

function createSavedPaymentMethodGateway(configService: ConfigService) {
  const provider = resolvePaymentGatewayProvider(configService);
  switch (provider) {
    case 'mock':
      return new MockSavedPaymentMethodGateway();
    case 'stripe':
      return new StripeSavedPaymentMethodGateway(configService);
    default:
      return new UnsupportedSavedPaymentMethodGateway(provider);
  }
}

/**
 * Payment module with configurable gateway.
 *
 * PAYMENT_GATEWAY selects the PSP adapter (mock, stripe, adyen, mollie, square, braintree).
 * When unset, STRIPE_MODE controls legacy behavior:
 * - 'mock' (default) → MockGateway — no HTTP calls. Use for tests and CI.
 * - 'test' | 'live' → StripeGateway — requires STRIPE_SECRET_KEY.
 *
 * Alternative PSPs run in console mode (logged mock success) when their env credentials
 * are missing; set the provider's API keys to enable real HTTP calls.
 */
@Module({
  imports: [ConfigModule, FolioModule, WebhookModule],
  controllers: [PaymentController, StripeWebhookController],
  providers: [
    PaymentService,
    {
      provide: PAYMENT_GATEWAY,
      useFactory: (configService: ConfigService) => createPaymentGateway(configService),
      inject: [ConfigService],
    },
    {
      provide: SAVED_PAYMENT_METHOD_GATEWAY,
      useFactory: (configService: ConfigService) =>
        createSavedPaymentMethodGateway(configService),
      inject: [ConfigService],
    },
  ],
  exports: [PaymentService, PAYMENT_GATEWAY, SAVED_PAYMENT_METHOD_GATEWAY],
})
export class PaymentModule {}
