import { Module } from '@nestjs/common';
import { ImportController } from './import.controller';
import { ImportService } from './import.service';
import { GuestModule } from '../guest/guest.module';
import { RoomModule } from '../room/room.module';
import { RatePlanModule } from '../rate-plan/rate-plan.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [GuestModule, RoomModule, RatePlanModule, AuthModule],
  controllers: [ImportController],
  providers: [ImportService],
})
export class ImportModule {}
