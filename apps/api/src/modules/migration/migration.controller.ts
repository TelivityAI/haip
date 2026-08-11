import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';
import { Roles } from '../auth/roles.decorator';
import { RequirePermissions } from '../auth/permissions.decorator';
import { MigrationService } from './migration.service';
import { MigrationQueueService } from './migration-queue.service';
import { CreateMigrationJobDto } from './dto/create-migration-job.dto';

class StoreCredentialDto {
  @ApiProperty({ description: 'Source PMS key, e.g. "mews", "cloudbeds", "apaleo"' })
  @IsString()
  @MaxLength(60)
  sourcePms!: string;

  @ApiProperty({ description: 'API token / OAuth payload for the source PMS (stored encrypted)' })
  @IsString()
  secret!: string;
}

/**
 * PMS migration — `/api/v1/migration/*` (TEL-67/70). Staff-facing,
 * `settings.manage`. Jobs are durable + resumable; `propertyId` is required on
 * every route and scopes every query (multi-tenancy).
 *
 * Credentials endpoints store ciphertext only — plaintext never appears in any
 * response, log line, or audit row.
 */
@ApiTags('migration')
@Controller('migration')
@Roles('admin')
export class MigrationController {
  constructor(
    private readonly migrationService: MigrationService,
    private readonly queue: MigrationQueueService,
  ) {}

  @Post('jobs')
  @RequirePermissions('settings.manage')
  @ApiOperation({ summary: 'Create + enqueue a migration job (one entity batch)' })
  async createJob(@Body() dto: CreateMigrationJobDto) {
    const job = await this.migrationService.createJob(dto);
    await this.queue.enqueue(job.id, dto.propertyId);
    return this.migrationService.getJob(dto.propertyId, job.id);
  }

  @Get('jobs')
  @RequirePermissions('settings.manage')
  @ApiOperation({ summary: 'List migration jobs for a property (optionally per project)' })
  listJobs(
    @Query('propertyId', new ParseUUIDPipe()) propertyId: string,
    @Query('projectRef') projectRef?: string,
  ) {
    return this.migrationService.listJobs(propertyId, projectRef);
  }

  @Get('jobs/:id')
  @RequirePermissions('settings.manage')
  @ApiOperation({ summary: 'Migration job status + counts + row errors' })
  getJob(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query('propertyId', new ParseUUIDPipe()) propertyId: string,
  ) {
    return this.migrationService.getJob(propertyId, id);
  }

  @Post('jobs/:id/cancel')
  @RequirePermissions('settings.manage')
  @ApiOperation({ summary: 'Cancel a pending/running migration job' })
  cancelJob(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query('propertyId', new ParseUUIDPipe()) propertyId: string,
  ) {
    return this.migrationService.cancelJob(propertyId, id);
  }

  @Post('credentials')
  @RequirePermissions('settings.manage')
  @ApiOperation({ summary: 'Store a source-PMS credential (AES-256-GCM at rest)' })
  storeCredential(
    @Query('propertyId', new ParseUUIDPipe()) propertyId: string,
    @Body() dto: StoreCredentialDto,
  ) {
    return this.migrationService.storeSourceCredential(propertyId, dto.sourcePms, dto.secret);
  }

  @Delete('credentials/:sourcePms')
  @RequirePermissions('settings.manage')
  @ApiOperation({ summary: 'Delete a stored source-PMS credential' })
  deleteCredential(
    @Param('sourcePms') sourcePms: string,
    @Query('propertyId', new ParseUUIDPipe()) propertyId: string,
  ) {
    return this.migrationService.deleteSourceCredential(propertyId, sourcePms);
  }
}
