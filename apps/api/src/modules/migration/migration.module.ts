import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ImportModule } from '../import/import.module';
import { ReservationModule } from '../reservation/reservation.module';
import { MigrationController } from './migration.controller';
import { MigrationService } from './migration.service';
import { MigrationStepProcessorService } from './migration-step-processor.service';
import { MigrationLegacyIdMapModule } from './migration-legacy-id-map.module';
import { MigrationSourceCredentialsService } from './migration-source-credentials.service';

@Module({
  imports: [AuthModule, MigrationLegacyIdMapModule, ImportModule, ReservationModule],
  controllers: [MigrationController],
  providers: [
    MigrationService,
    MigrationStepProcessorService,
    MigrationSourceCredentialsService,
  ],
  exports: [
    MigrationLegacyIdMapModule,
    MigrationService,
    MigrationStepProcessorService,
    MigrationSourceCredentialsService,
  ],
})
export class MigrationModule {}
