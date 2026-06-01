import { Module } from '@nestjs/common';
import { WebhookModule } from '../webhook/webhook.module';
import { HouseAccountController } from './house-account.controller';
import { HouseAccountService } from './house-account.service';

@Module({
  imports: [WebhookModule],
  controllers: [HouseAccountController],
  providers: [HouseAccountService],
  exports: [HouseAccountService],
})
export class HouseAccountModule {}
