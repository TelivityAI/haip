import { Module } from '@nestjs/common';
import { FolioModule } from '../folio/folio.module';
import { AuthModule } from '../auth/auth.module';
import { PosController } from './pos.controller';
import { PosService } from './pos.service';

@Module({
  imports: [FolioModule, AuthModule],
  controllers: [PosController],
  providers: [PosService],
  exports: [PosService],
})
export class PosModule {}
