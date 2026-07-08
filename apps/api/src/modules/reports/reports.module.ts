import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { PortfolioPropertyResolver } from './portfolio-property-resolver';

@Module({
  controllers: [ReportsController],
  providers: [ReportsService, PortfolioPropertyResolver],
  exports: [ReportsService, PortfolioPropertyResolver],
})
export class ReportsModule {}
