import { Module } from '@nestjs/common';
import { MigrationController } from './migration.controller';
import { MigrationService } from './migration.service';
import { MigrationQueueService } from './migration-queue.service';
import { MigrationIdMapService } from './migration-id-map.service';
import { MigrationCryptoService } from './migration-crypto.service';
import { GuestModule } from '../guest/guest.module';
import { RoomModule } from '../room/room.module';
import { RatePlanModule } from '../rate-plan/rate-plan.module';
import { ReservationModule } from '../reservation/reservation.module';
import { FolioModule } from '../folio/folio.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [GuestModule, RoomModule, RatePlanModule, ReservationModule, FolioModule, AuthModule],
  controllers: [MigrationController],
  providers: [MigrationService, MigrationQueueService, MigrationIdMapService, MigrationCryptoService],
  exports: [MigrationService, MigrationIdMapService],
})
export class MigrationModule {}
