import { Module } from '@nestjs/common';
import { AccountingExportController } from './accounting-export.controller';
import { AccountingExportService } from './accounting-export.service';
import { AccountingExportListener } from './accounting-export.listener';
import { ReportsModule } from '../reports/reports.module';
import { AuthModule } from '../auth/auth.module';
import { WebhookModule } from '../webhook/webhook.module';

@Module({
  imports: [ReportsModule, AuthModule, WebhookModule],
  controllers: [AccountingExportController],
  providers: [AccountingExportService, AccountingExportListener],
})
export class AccountingExportModule {}
