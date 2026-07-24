import { Module } from '@nestjs/common';
import { TurnawaysController } from './turnaways.controller';
import { TurnawaysService } from './turnaways.service';

@Module({
  controllers: [TurnawaysController],
  providers: [TurnawaysService],
  exports: [TurnawaysService],
})
export class TurnawaysModule {}
