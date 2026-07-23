import { Module } from '@nestjs/common';
import { WebhookModule } from '../webhook/webhook.module';
import { RoomController } from './room.controller';
import { RoomService } from './room.service';
import { RoomStatusService } from './room-status.service';
import { RoomDiscrepancyService } from './room-discrepancy.service';

@Module({
  imports: [WebhookModule],
  controllers: [RoomController],
  providers: [RoomService, RoomStatusService, RoomDiscrepancyService],
  exports: [RoomService, RoomStatusService, RoomDiscrepancyService],
})
export class RoomModule {}
