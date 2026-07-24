import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FolioModule } from '../folio/folio.module';
import { FolioInboundController } from './folio-inbound.controller';
import { FolioInboundService } from './folio-inbound.service';

@Module({
  imports: [FolioModule, AuthModule],
  controllers: [FolioInboundController],
  providers: [FolioInboundService],
  exports: [FolioInboundService],
})
export class FolioInboundModule {}
