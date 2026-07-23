import { Module } from '@nestjs/common';
import { FolioModule } from '../folio/folio.module';
import { ReservationModule } from '../reservation/reservation.module';
import { HousekeepingModule } from '../housekeeping/housekeeping.module';
import { RoomModule } from '../room/room.module';
import { WebhookModule } from '../webhook/webhook.module';
import { AncillaryModule } from '../ancillary/ancillary.module';
import { AccountingModule } from '../accounting/accounting.module';
import { PolicyModule } from '../policy/policy.module';
import { NightAuditController } from './night-audit.controller';
import { NightAuditService } from './night-audit.service';

@Module({
  imports: [
    FolioModule,
    ReservationModule,
    HousekeepingModule,
    RoomModule,
    WebhookModule,
    AncillaryModule,
    AccountingModule,
    PolicyModule,
  ],
  controllers: [NightAuditController],
  providers: [NightAuditService],
  exports: [NightAuditService],
})
export class NightAuditModule {}
