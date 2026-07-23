import {
  Controller,
  Get,
  Query,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { ReportsService } from './reports.service';
import { PortfolioPropertyResolver } from './portfolio-property-resolver';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';

@ApiTags('reports')
@Controller('reports')
// Financial / occupancy reports are management data. Without this, RolesGuard and
// PermissionsGuard default-allow any authenticated user (e.g. housekeeping) for a
// property they belong to. PermissionsGuard enforces this for every route below.
@RequirePermissions('reports.view')
export class ReportsController {
  constructor(
    private readonly reportsService: ReportsService,
    private readonly portfolioResolver: PortfolioPropertyResolver,
    private readonly configService: ConfigService,
  ) {}

  private authOn(): boolean {
    return this.configService.get<string>('AUTH_ENABLED', 'true') !== 'false';
  }

  private parsePropertyIds(raw?: string): string[] | undefined {
    if (!raw) return undefined;
    return raw.split(',').map((s) => s.trim()).filter(Boolean);
  }

  @Get()
  @ApiOperation({ summary: 'Available reports' })
  async listReports() {
    return {
      reports: [
        'daily-revenue',
        'occupancy',
        'financial-summary',
        'trial-balance',
        'occupancy-trend',
        'booking-pace',
      ],
    };
  }

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

  @Get('/booking-pace')
  @ApiOperation({ summary: 'Booking pace — rooms on books per stay date + daily new bookings' })
  @ApiQuery({ name: 'propertyId', required: true })
  @ApiQuery({ name: 'startDate', required: true })
  @ApiQuery({ name: 'endDate', required: true })
  async getBookingPace(
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
  ) {
    return this.reportsService.getBookingPace(propertyId, startDate, endDate);
  }

  @Get('/portfolio/financial-summary')
  @ApiOperation({ summary: 'Portfolio financial summary across properties' })
  @ApiQuery({ name: 'date', required: true })
  @ApiQuery({ name: 'organizationId', required: false })
  @ApiQuery({ name: 'propertyIds', required: false, description: 'Comma-separated property UUIDs' })
  async getPortfolioFinancialSummary(
    @Query('date') date: string,
    @Query('organizationId') organizationId: string | undefined,
    @Query('propertyIds') propertyIdsRaw: string | undefined,
    @CurrentUser() user?: AuthUser,
  ) {
    const propertyIds = await this.portfolioResolver.resolvePropertyIds(
      user,
      this.authOn(),
      organizationId,
      this.parsePropertyIds(propertyIdsRaw),
    );
    return this.reportsService.getPortfolioFinancialSummary(propertyIds, date);
  }

  @Get('/portfolio/occupancy')
  @ApiOperation({ summary: 'Portfolio occupancy across properties' })
  @ApiQuery({ name: 'date', required: true })
  @ApiQuery({ name: 'organizationId', required: false })
  @ApiQuery({ name: 'propertyIds', required: false, description: 'Comma-separated property UUIDs' })
  async getPortfolioOccupancy(
    @Query('date') date: string,
    @Query('organizationId') organizationId: string | undefined,
    @Query('propertyIds') propertyIdsRaw: string | undefined,
    @CurrentUser() user?: AuthUser,
  ) {
    const propertyIds = await this.portfolioResolver.resolvePropertyIds(
      user,
      this.authOn(),
      organizationId,
      this.parsePropertyIds(propertyIdsRaw),
    );
    return this.reportsService.getPortfolioOccupancy(propertyIds, date);
  }
}
