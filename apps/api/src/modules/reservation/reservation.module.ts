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
import { AncillaryModule } from '../ancillary/ancillary.module';
import { AccountingModule } from '../accounting/accounting.module';
import { PolicyModule } from '../policy/policy.module';
<<<<<<< HEAD
import { RatePlanModule } from '../rate-plan/rate-plan.module';
=======
import { NotificationsModule } from '../notifications/notifications.module';
>>>>>>> 6185d84 (feat(guest-journey): Slice 6 depth — pre-register API and SMS messaging)

@Module({
  imports: [
    forwardRef(() => FolioModule),
    RoomModule,
    PaymentModule,
    WebhookModule,
    forwardRef(() => AncillaryModule),
    AccountingModule,
    PolicyModule,
<<<<<<< HEAD
    RatePlanModule,
=======
    NotificationsModule,
>>>>>>> 6185d84 (feat(guest-journey): Slice 6 depth — pre-register API and SMS messaging)
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
