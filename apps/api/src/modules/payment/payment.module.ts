import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { FolioModule } from '../folio/folio.module';
import { WebhookModule } from '../webhook/webhook.module';
import { PaymentController } from './payment.controller';
import { StripeWebhookController } from './stripe-webhook.controller';
import { PaymentService } from './payment.service';
import { PAYMENT_GATEWAY } from './interfaces/payment-gateway.interface';
import { createPaymentGateway } from './payment-gateway.factory';

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
  ],
  exports: [PaymentService],
})
export class PaymentModule {}
