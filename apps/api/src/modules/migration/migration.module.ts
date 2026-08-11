import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MigrationController } from './migration.controller';
import { MigrationSourceCredentialsService } from './migration-source-credentials.service';

@Module({
  imports: [AuthModule],
  controllers: [MigrationController],
  providers: [MigrationSourceCredentialsService],
  exports: [MigrationSourceCredentialsService],
})
export class MigrationModule {}
