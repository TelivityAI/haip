import { Module } from '@nestjs/common';
import { ProfessionController } from './profession.controller';
import { ProfessionService } from './profession.service';

@Module({
  controllers: [ProfessionController],
  providers: [ProfessionService],
  exports: [ProfessionService],
})
export class ProfessionModule {}
