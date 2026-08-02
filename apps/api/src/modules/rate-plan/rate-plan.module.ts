import { Module } from '@nestjs/common';
import { RatePlanController } from './rate-plan.controller';
import { RatePlanService } from './rate-plan.service';
import { WebhookModule } from '../webhook/webhook.module';

@Module({
  imports: [WebhookModule],
  controllers: [RatePlanController],
  providers: [RatePlanService],
  exports: [RatePlanService],
})
export class RatePlanModule {}
