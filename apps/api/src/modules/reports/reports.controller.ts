import {
  Controller,
  Get,
  Query,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { ReportsService } from './reports.service';
import { RequirePermissions } from '../auth/permissions.decorator';

@ApiTags('reports')
@Controller('reports')
// Financial / occupancy reports are management data. Without this, RolesGuard and
// PermissionsGuard default-allow any authenticated user (e.g. housekeeping) for a
// property they belong to. PermissionsGuard enforces this for every route below.
@RequirePermissions('reports.view')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('/daily-revenue')
  @ApiOperation({ summary: 'Daily revenue report' })
  @ApiQuery({ name: 'propertyId', required: true })
  @ApiQuery({ name: 'date', required: true })
  async getDailyRevenue(
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @Query('date') date: string,
  ) {
    return this.reportsService.getDailyRevenue(propertyId, date);
  }

  @Get('/occupancy')
  @ApiOperation({ summary: 'Occupancy report' })
  @ApiQuery({ name: 'propertyId', required: true })
  @ApiQuery({ name: 'date', required: true })
  async getOccupancy(
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @Query('date') date: string,
  ) {
    return this.reportsService.getOccupancy(propertyId, date);
  }

  @Get('/financial-summary')
  @ApiOperation({ summary: 'Financial summary (Manager\'s Report)' })
  @ApiQuery({ name: 'propertyId', required: true })
  @ApiQuery({ name: 'date', required: true })
  async getFinancialSummary(
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @Query('date') date: string,
  ) {
    return this.reportsService.getFinancialSummary(propertyId, date);
  }

  @Get('/trial-balance')
  @ApiOperation({ summary: 'Daily trial balance (Deposit / Guest / A/R ledgers)' })
  @ApiQuery({ name: 'propertyId', required: true })
  @ApiQuery({ name: 'date', required: true })
  async getTrialBalance(
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @Query('date') date: string,
  ) {
    return this.reportsService.dailyTrialBalance(propertyId, date);
  }

  @Get('/occupancy-trend')
  @ApiOperation({ summary: 'Occupancy trend report over date range' })
  @ApiQuery({ name: 'propertyId', required: true })
  @ApiQuery({ name: 'startDate', required: true })
  @ApiQuery({ name: 'endDate', required: true })
  async getOccupancyTrend(
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
  ) {
    return this.reportsService.getOccupancyTrend(propertyId, startDate, endDate);
  }
}
