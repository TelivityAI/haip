import { Module } from '@nestjs/common';
import { PropertyController } from './property.controller';
import { OrganizationController } from './organization.controller';
import { PropertyService } from './property.service';
import { OrganizationService } from './organization.service';
import { WebhookModule } from '../webhook/webhook.module';

@Module({
  imports: [WebhookModule],
  controllers: [PropertyController, OrganizationController],
  providers: [PropertyService, OrganizationService],
  exports: [PropertyService, OrganizationService],
})
export class PropertyModule {}
