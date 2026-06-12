import { Module } from '@nestjs/common';
import { WebhookModule } from '../webhook/webhook.module';
import { FolioModule } from '../folio/folio.module';
import { ReservationModule } from '../reservation/reservation.module';
import { GroupsController } from './groups.controller';
import { GroupProfileService } from './group-profile.service';
import { AllotmentService } from './allotment.service';
import { RoomingListService } from './rooming-list.service';

@Module({
  imports: [WebhookModule, FolioModule, ReservationModule],
  controllers: [GroupsController],
  providers: [GroupProfileService, AllotmentService, RoomingListService],
  exports: [GroupProfileService, AllotmentService, RoomingListService],
})
export class GroupsModule {}
