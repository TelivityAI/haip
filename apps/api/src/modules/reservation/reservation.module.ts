import { Module, forwardRef } from '@nestjs/common';
import { ReservationController } from './reservation.controller';
import { ReservationService } from './reservation.service';
import { AvailabilityService } from './availability.service';
import { ReservationNotesService } from './reservation-notes.service';
import { ReservationMessagingService } from './reservation-messaging.service';
import { ReservationImportService } from './reservation-import.service';
import { EmailModule } from '../agent/guest-comms/email.module';
import { FolioModule } from '../folio/folio.module';
import { RoomModule } from '../room/room.module';
import { PaymentModule } from '../payment/payment.module';
import { WebhookModule } from '../webhook/webhook.module';
import { AncillaryModule } from '../ancillary/ancillary.module';
import { AccountingModule } from '../accounting/accounting.module';
import { PolicyModule } from '../policy/policy.module';
import { RatePlanModule } from '../rate-plan/rate-plan.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    forwardRef(() => FolioModule),
    RoomModule,
    PaymentModule,
    WebhookModule,
    forwardRef(() => AncillaryModule),
    AccountingModule,
    PolicyModule,
    RatePlanModule,
    NotificationsModule,
    EmailModule,
  ],
  controllers: [ReservationController],
  providers: [
    ReservationService,
    AvailabilityService,
    ReservationNotesService,
    ReservationMessagingService,
    ReservationImportService,
  ],
  exports: [ReservationService, AvailabilityService],
})
export class ReservationModule {}
