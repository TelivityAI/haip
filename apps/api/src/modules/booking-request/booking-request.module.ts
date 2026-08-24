import { Module } from '@nestjs/common';
import { AncillaryModule } from '../ancillary/ancillary.module';
import { BookingEngineModule } from '../booking-engine/booking-engine.module';
import { BookingThrottleGuard } from '../booking-engine/booking-throttle.guard';
import { BookingEngineScopeGuard } from '../auth/booking-engine-scope.guard';
import { BookingKeyGuard } from '../auth/booking-key.guard';
import { PaymentModule } from '../payment/payment.module';
import { RatePlanModule } from '../rate-plan/rate-plan.module';
import { ReservationModule } from '../reservation/reservation.module';
import { FolioModule } from '../folio/folio.module';
import { GuestModule } from '../guest/guest.module';
import { WebhookModule } from '../webhook/webhook.module';
import { EmailModule } from '../agent/guest-comms/email.module';
import { BookingRequestController } from './booking-request.controller';
import { BookingRequestPublicController } from './booking-request-public.controller';
import { BookingRequestService } from './booking-request.service';
import { BookingRequestConsequenceWorkerService } from './booking-request-consequence-worker.service';
import { BookingRequestPaymentService } from './booking-request-payment.service';
import { BookingRequestMailerService } from './booking-request-mailer.service';

@Module({
  imports: [
    BookingEngineModule,
    ReservationModule,
    RatePlanModule,
    PaymentModule,
    WebhookModule,
    GuestModule,
    FolioModule,
    AncillaryModule,
    EmailModule,
  ],
  controllers: [BookingRequestPublicController, BookingRequestController],
  providers: [
    BookingRequestService,
    BookingRequestPaymentService,
    BookingRequestMailerService,
    BookingRequestConsequenceWorkerService,
    BookingKeyGuard,
    BookingEngineScopeGuard,
    BookingThrottleGuard,
  ],
  exports: [BookingRequestService, BookingRequestPaymentService, BookingRequestMailerService],
})
export class BookingRequestModule {}
