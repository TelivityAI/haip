import { Module } from '@nestjs/common';
import { LostAndFoundController } from './lost-and-found.controller';
import { LostAndFoundService } from './lost-and-found.service';

@Module({
  controllers: [LostAndFoundController],
  providers: [LostAndFoundService],
  exports: [LostAndFoundService],
})
export class LostAndFoundModule {}
