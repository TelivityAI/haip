import { Module } from '@nestjs/common';
import { AgentController } from './agent.controller';
import { AgentService } from './agent.service';
import { WebhookModule } from '../webhook/webhook.module';
import { LlmModule } from '../llm/llm.module';
import { DemandForecastAgent } from './demand/demand.agent';
import { DynamicPricingAgent } from './pricing/pricing.agent';
import { ChannelMixAgent } from './channel-mix/channel-mix.agent';
import { OverbookingAgent } from './overbooking/overbooking.agent';
import { NightAuditAnomalyAgent } from './night-audit/night-audit-anomaly.agent';
import { HousekeepingOptimizerAgent } from './housekeeping/housekeeping-optimizer.agent';
import { CancellationPredictorAgent } from './cancellation/cancellation-predictor.agent';
import { GuestCommunicationAgent } from './guest-comms/guest-communication.agent';
import { GuestCommsListener } from './guest-comms/guest-comms.listener';
import { ReviewResponseAgent } from './review-response/review-response.agent';
import { ArCollectionsAgent } from './ar-collections/ar-collections.agent';
import { GroupPickupAgent } from './group-pickup/group-pickup.agent';
import { RevenueManagerAgent } from './revenue-manager/revenue-manager.agent';
import { EmailModule } from './guest-comms/email.module';

@Module({
  imports: [WebhookModule, LlmModule, EmailModule],
  controllers: [AgentController],
  providers: [
    AgentService,
    DemandForecastAgent,
    DynamicPricingAgent,
    ChannelMixAgent,
    OverbookingAgent,
    NightAuditAnomalyAgent,
    HousekeepingOptimizerAgent,
    CancellationPredictorAgent,
    GuestCommunicationAgent,
    GuestCommsListener,
    ReviewResponseAgent,
    ArCollectionsAgent,
    GroupPickupAgent,
    RevenueManagerAgent,
  ],
  exports: [AgentService, DemandForecastAgent],
})
export class AgentModule {}
