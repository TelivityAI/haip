import { Module } from '@nestjs/common';
import { AccountingExportController } from './accounting-export.controller';
import { AccountingExportService } from './accounting-export.service';
import { ReportsModule } from '../reports/reports.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [ReportsModule, AuthModule],
  controllers: [AccountingExportController],
  providers: [AccountingExportService],
})
export class AccountingExportModule {}
