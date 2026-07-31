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
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { Roles } from '../auth/roles.decorator';
import { NightAuditService } from './night-audit.service';
import { RunAuditDto } from './dto/run-audit.dto';

@ApiTags('night-audit')
@Controller('night-audit')
export class NightAuditController {
  constructor(private readonly nightAuditService: NightAuditService) {}

  @Post('/run')
  @Roles('admin', 'general_manager', 'night_auditor', 'accounting')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Execute night audit for a business date' })
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
