import { Module } from '@nestjs/common';
import { WebhookModule } from '../webhook/webhook.module';
import { CashierController } from './cashier.controller';
import { CashierService } from './cashier.service';

@Module({
  imports: [WebhookModule],
  controllers: [CashierController],
  providers: [CashierService],
  exports: [CashierService],
})
export class CashierModule {}
