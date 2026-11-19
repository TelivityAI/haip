import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { PortfolioPropertyResolver } from './portfolio-property-resolver';
import { RateOverridesReportService } from './rate-overrides-report.service';

@Module({
  controllers: [ReportsController],
  providers: [ReportsService, PortfolioPropertyResolver, RateOverridesReportService],
  exports: [ReportsService, PortfolioPropertyResolver, RateOverridesReportService],
})
export class ReportsModule {}
