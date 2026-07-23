import { Module } from '@nestjs/common';
import { WebhookModule } from '../webhook/webhook.module';
import { FolioModule } from '../folio/folio.module';
import { AccountingController } from './accounting.controller';
import { DepositService } from './deposit.service';
import { DepositSettlementService } from './deposit-settlement.service';
import { ArService } from './ar.service';
import { AccountingCodeService } from './accounting-code.service';

@Module({
  imports: [WebhookModule, FolioModule],
  controllers: [AccountingController],
  providers: [DepositService, DepositSettlementService, ArService, AccountingCodeService],
  exports: [DepositService, DepositSettlementService, ArService, AccountingCodeService],
})
export class AccountingModule {}
