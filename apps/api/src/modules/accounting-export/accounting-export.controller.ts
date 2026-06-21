import { Controller, Get, Query, Header, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Roles } from '../auth/roles.decorator';
import { RequirePermissions } from '../auth/permissions.decorator';
import { AccountingExportService } from './accounting-export.service';

/**
 * Accounting export — `/api/v1/accounting-export/*`. Staff-facing (Keycloak-gated,
 * `reports.view`). Returns plain CSV (text/csv) for the self-hoster to import into
 * their own accounting system. `propertyId` is a required, UUID-validated query
 * param (multi-tenancy).
 */
@ApiTags('accounting-export')
@Controller('accounting-export')
@Roles('admin')
export class AccountingExportController {
  constructor(private readonly service: AccountingExportService) {}

  @Get('revenue-journal.csv')
  @RequirePermissions('reports.view')
  @Header('Content-Type', 'text/csv')
  @Header('Content-Disposition', 'attachment; filename="revenue-journal.csv"')
  @ApiOperation({ summary: 'Daily revenue journal as CSV' })
  revenueJournal(
    @Query('propertyId', new ParseUUIDPipe()) propertyId: string,
    @Query('date') date: string,
  ) {
    return this.service.revenueJournalCsv(propertyId, date);
  }

  @Get('trial-balance.csv')
  @RequirePermissions('reports.view')
  @Header('Content-Type', 'text/csv')
  @Header('Content-Disposition', 'attachment; filename="trial-balance.csv"')
  @ApiOperation({ summary: 'Daily trial balance as CSV' })
  trialBalance(
    @Query('propertyId', new ParseUUIDPipe()) propertyId: string,
    @Query('date') date: string,
  ) {
    return this.service.trialBalanceCsv(propertyId, date);
  }
}
