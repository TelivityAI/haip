import { Module } from '@nestjs/common';
import { MigrationController } from './migration.controller';
import { MigrationService } from './migration.service';
import { MigrationStepProcessorService } from './migration-step-processor.service';
import { MigrationLegacyIdMapModule } from './migration-legacy-id-map.module';
import { ImportModule } from '../import/import.module';
import { ReservationModule } from '../reservation/reservation.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [MigrationLegacyIdMapModule, ImportModule, ReservationModule, AuthModule],
  controllers: [MigrationController],
  providers: [MigrationService, MigrationStepProcessorService],
  exports: [MigrationLegacyIdMapModule, MigrationService, MigrationStepProcessorService],
})
export class MigrationModule {}
