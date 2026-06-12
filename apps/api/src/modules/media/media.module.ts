import { Module } from '@nestjs/common';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';
import { StorageService } from './storage/storage.service';
import { WebhookModule } from '../webhook/webhook.module';

@Module({
  imports: [WebhookModule],
  controllers: [MediaController],
  providers: [MediaService, StorageService],
  exports: [MediaService],
})
export class MediaModule {}
