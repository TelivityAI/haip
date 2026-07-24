import { Module } from '@nestjs/common';
import { IcalController } from './ical.controller';
import { IcalService } from './ical.service';

@Module({
  controllers: [IcalController],
  providers: [IcalService],
  exports: [IcalService],
})
export class IcalModule {}
