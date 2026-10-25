import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ConnectController } from './connect.controller';
import { ConnectSearchService } from './connect-search.service';
import { ConnectContentService } from './connect-content.service';
import { ConnectBookingService } from './connect-booking.service';
import { ConnectEventsService } from './connect-events.service';
import { ConnectInsightsService } from './connect-insights.service';
import { ConnectPaymentService } from './connect-payment.service';
import { ConnectCredentialsController } from './connect-credentials.controller';
import { ConnectCredentialsService } from './connect-credentials.service';
import { ReservationModule } from '../reservation/reservation.module';
import { WebhookModule } from '../webhook/webhook.module';
import { AuthModule } from '../auth/auth.module';
import { RatePlanModule } from '../rate-plan/rate-plan.module';
import { PolicyModule } from '../policy/policy.module';
import { FolioModule } from '../folio/folio.module';
import { PaymentModule } from '../payment/payment.module';
import { CONNECT_CHECKOUT_STRIPE_HANDLER } from '../payment/connect-checkout-stripe-handler.interface';

@Module({
  imports: [
    ConfigModule,
    ReservationModule,
    WebhookModule,
    AuthModule,
    RatePlanModule,
    PolicyModule,
    FolioModule,
    PaymentModule,
  ],
  controllers: [ConnectController, ConnectCredentialsController],
  providers: [
    ConnectSearchService,
    ConnectContentService,
    ConnectBookingService,
    ConnectEventsService,
    ConnectInsightsService,
    ConnectCredentialsService,
    ConnectPaymentService,
    {
      provide: CONNECT_CHECKOUT_STRIPE_HANDLER,
      useExisting: ConnectPaymentService,
    },
  ],
  exports: [ConnectSearchService, ConnectBookingService, ConnectPaymentService],
})
export class ConnectModule {}
