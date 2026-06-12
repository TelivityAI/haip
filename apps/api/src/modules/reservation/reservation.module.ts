import { Module, forwardRef } from '@nestjs/common';
import { ReservationController } from './reservation.controller';
import { ReservationService } from './reservation.service';
import { AvailabilityService } from './availability.service';
import { ReservationNotesService } from './reservation-notes.service';
import { ReservationMessagingService } from './reservation-messaging.service';
import { ReservationImportService } from './reservation-import.service';
import { EmailService } from '../agent/guest-comms/email.service';
import { FolioModule } from '../folio/folio.module';
import { RoomModule } from '../room/room.module';
import { PaymentModule } from '../payment/payment.module';
import { WebhookModule } from '../webhook/webhook.module';

@Module({
  imports: [
    forwardRef(() => FolioModule),
    RoomModule,
    PaymentModule,
    WebhookModule,
  ],
  controllers: [ReservationController],
  providers: [
    ReservationService,
    AvailabilityService,
    ReservationNotesService,
    ReservationMessagingService,
    ReservationImportService,
    // EmailService has no constructor deps requiring AgentModule (env + logger
    // only), so we register it directly here to avoid cross-module export churn.
    EmailService,
  ],
  exports: [ReservationService, AvailabilityService],
})
export class ReservationModule {}
