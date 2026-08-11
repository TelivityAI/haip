import { Module } from '@nestjs/common';
import { MigrationLegacyIdMapService } from './migration-legacy-id-map.service';

@Module({
  providers: [MigrationLegacyIdMapService],
  exports: [MigrationLegacyIdMapService],
})
export class MigrationLegacyIdMapModule {}
