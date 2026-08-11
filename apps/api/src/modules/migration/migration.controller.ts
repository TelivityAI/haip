import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Roles } from '../auth/roles.decorator';
import { RequirePermissions } from '../auth/permissions.decorator';
import { MigrationService } from './migration.service';
import { CreateMigrationJobDto } from './dto/create-migration-job.dto';

/**
 * Durable PMS migration jobs — create, poll status, resume from checkpoint.
 * `propertyId` is a required query param on every route (multi-tenancy).
 */
@ApiTags('migration')
@Controller('migration')
@Roles('admin')
export class MigrationController {
  constructor(private readonly migrationService: MigrationService) {}

  @Post('jobs')
  @RequirePermissions('settings.manage')
  @ApiOperation({ summary: 'Create a migration import job (async, resumable)' })
  createJob(
    @Query('propertyId', new ParseUUIDPipe()) propertyId: string,
    @Body() dto: CreateMigrationJobDto,
  ) {
    return this.migrationService.createJob(propertyId, dto);
  }

  @Get('jobs/:id')
  @RequirePermissions('settings.manage')
  @ApiOperation({ summary: 'Poll migration job status and per-row results' })
  getJob(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query('propertyId', new ParseUUIDPipe()) propertyId: string,
  ) {
    return this.migrationService.getJob(id, propertyId);
  }

  @Post('jobs/:id/resume')
  @RequirePermissions('settings.manage')
  @ApiOperation({ summary: 'Resume a failed or paused migration job from its checkpoint' })
  resumeJob(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query('propertyId', new ParseUUIDPipe()) propertyId: string,
  ) {
    return this.migrationService.resumeJob(id, propertyId);
  }
}
