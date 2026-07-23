import { Module } from '@nestjs/common';
import { FolioModule } from '../folio/folio.module';
import { WebhookModule } from '../webhook/webhook.module';
import { AncillaryController } from './ancillary.controller';
import { AncillaryService } from './ancillary.service';

@Module({
  imports: [FolioModule, WebhookModule],
  controllers: [AncillaryController],
  providers: [AncillaryService],
  exports: [AncillaryService],
})
export class AncillaryModule {}
