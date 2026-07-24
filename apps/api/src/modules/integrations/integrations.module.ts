import { Module } from '@nestjs/common';
import { IntegrationsCatalogController } from './integrations.controller';
import { PropertyIntegrationsController } from './property-integrations.controller';
import { IntegrationsService } from './integrations.service';

@Module({
  controllers: [IntegrationsCatalogController, PropertyIntegrationsController],
  providers: [IntegrationsService],
  exports: [IntegrationsService],
})
export class IntegrationsModule {}
