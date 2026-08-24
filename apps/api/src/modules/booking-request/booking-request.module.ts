import { Module } from '@nestjs/common';
import { BookingEngineModule } from '../booking-engine/booking-engine.module';
import { BookingThrottleGuard } from '../booking-engine/booking-throttle.guard';
import { BookingEngineScopeGuard } from '../auth/booking-engine-scope.guard';
import { BookingKeyGuard } from '../auth/booking-key.guard';
import { PaymentModule } from '../payment/payment.module';
import { RatePlanModule } from '../rate-plan/rate-plan.module';
import { ReservationModule } from '../reservation/reservation.module';
import { WebhookModule } from '../webhook/webhook.module';
import { BookingRequestPublicController } from './booking-request-public.controller';
import { BookingRequestService } from './booking-request.service';

@Module({
  imports: [
    BookingEngineModule,
    ReservationModule,
    RatePlanModule,
    PaymentModule,
    WebhookModule,
  ],
  controllers: [BookingRequestPublicController],
  providers: [
    BookingRequestService,
    BookingKeyGuard,
    BookingEngineScopeGuard,
    BookingThrottleGuard,
  ],
  exports: [BookingRequestService],
})
export class BookingRequestModule {}
