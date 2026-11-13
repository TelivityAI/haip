import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
  Headers,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { RequirePermissions } from '../auth/permissions.decorator';
import { Public } from '../auth/public.decorator';
import { NightAuditService } from './night-audit.service';
import { NightAuditSchedulerService } from './night-audit-scheduler.service';
import { RunAuditDto } from './dto/run-audit.dto';
import { RunDueAuditsDto } from './dto/run-due.dto';
import { assertNightAuditServiceToken } from './service-token';

@ApiTags('night-audit')
@Controller('night-audit')
export class NightAuditController {
  constructor(
    private readonly nightAuditService: NightAuditService,
    private readonly scheduler: NightAuditSchedulerService,
  ) {}

  @Public()
  @Post('/run-due')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Close every hotel whose local night-audit window is due',
    description:
      'Bearer HAIP_SERVICE_TOKEN. 503 when that token is unset. A hotel with an invalid timezone is reported and does not stop the others.',
  })
  async runDue(
    @Headers('authorization') authorization: string | undefined,
    @Body() dto: RunDueAuditsDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    assertNightAuditServiceToken(authorization);
    const result = await this.scheduler.runDue({
      forceWindow: dto.forceWindow,
      maxCatchupDays: dto.maxCatchupDays,
    });
    if (!result.ok) {
      const anyProgress = result.closedProperties > 0 || result.skippedBeforeCutoff > 0
        || result.failures.some((failure) => failure.closedDates.length > 0);
      res.status(anyProgress ? 207 : 502);
    }
    return result;
  }

  @Post('/run')
  @RequirePermissions('nightaudit.run')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Execute night audit for a business date',
    description:
      'Scheduled callers (scripts/cron/night-audit.sh) send mode "unattended". ' +
      'Omit mode, or send "manual", for a staff close. This service accepts the field and does not change close behavior based on it.',
  })
  async runAudit(@Body() dto: RunAuditDto) {
    return this.nightAuditService.runAudit(dto);
  }

  @Get('/runs')
  @ApiOperation({ summary: 'List audit runs for a property' })
  @ApiQuery({ name: 'propertyId', required: true })
  async listRuns(@Query('propertyId', ParseUUIDPipe) propertyId: string) {
    return this.nightAuditService.listAuditRuns(propertyId);
  }

  @Get('/runs/:id')
  @ApiOperation({ summary: 'Get a specific audit run' })
  @ApiQuery({ name: 'propertyId', required: true })
  async getRun(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('propertyId', ParseUUIDPipe) propertyId: string,
  ) {
    return this.nightAuditService.getAuditRun(id, propertyId);
  }
}
