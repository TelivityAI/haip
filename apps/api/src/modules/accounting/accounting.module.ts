import { Module } from '@nestjs/common';
import { WebhookModule } from '../webhook/webhook.module';
import { FolioModule } from '../folio/folio.module';
import { AccountingController } from './accounting.controller';
import { DepositService } from './deposit.service';
import { ArService } from './ar.service';
import { AccountingCodeService } from './accounting-code.service';

@Module({
  imports: [WebhookModule, FolioModule],
  controllers: [AccountingController],
  providers: [DepositService, ArService, AccountingCodeService],
  exports: [DepositService, ArService, AccountingCodeService],
})
export class AccountingModule {}
