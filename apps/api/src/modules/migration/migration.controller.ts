import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { MIGRATION_SOURCE_PMS } from '@telivityhaip/shared';
import { Roles } from '../auth/roles.decorator';
import { RequirePermissions } from '../auth/permissions.decorator';
import { AuditActorCtx, type AuditActor } from '../../common/audit/audit-actor';
import { MigrationSourceCredentialsService } from './migration-source-credentials.service';
import { UpsertMigrationCredentialDto } from './dto/upsert-migration-credential.dto';

/**
 * Automated PMS migration — encrypted source credential vault.
 * Credentials are encrypted at rest; API responses never include plaintext secrets.
 */
@ApiTags('migration')
@Controller('migration')
@Roles('admin')
export class MigrationController {
  constructor(private readonly credentials: MigrationSourceCredentialsService) {}

  @Get('credentials')
  @RequirePermissions('settings.manage')
  @ApiOperation({
    summary: 'List stored source-PMS credential metadata (no secret values)',
  })
  listCredentials(@Query('propertyId', new ParseUUIDPipe()) propertyId: string) {
    return this.credentials.listMetadata(propertyId);
  }

  @Post('credentials')
  @RequirePermissions('settings.manage')
  @ApiOperation({
    summary: 'Store or rotate encrypted source-PMS credentials for migration',
  })
  upsertCredentials(
    @Query('propertyId', new ParseUUIDPipe()) propertyId: string,
    @Body() dto: UpsertMigrationCredentialDto,
    @AuditActorCtx() actor: AuditActor,
  ) {
    return this.credentials.upsert(propertyId, dto.sourcePms, dto.credentials, actor);
  }

  @Delete('credentials/:sourcePms')
  @RequirePermissions('settings.manage')
  @ApiOperation({
    summary:
      'Erase encrypted source-PMS credentials (migration completion or GDPR erasure)',
  })
  deleteCredential(
    @Query('propertyId', new ParseUUIDPipe()) propertyId: string,
    @Param('sourcePms') sourcePms: string,
    @AuditActorCtx() actor: AuditActor,
  ) {
    if (!MIGRATION_SOURCE_PMS.includes(sourcePms as (typeof MIGRATION_SOURCE_PMS)[number])) {
      throw new BadRequestException(
        `sourcePms must be one of: ${MIGRATION_SOURCE_PMS.join(', ')}`,
      );
    }
    return this.credentials.delete(
      propertyId,
      sourcePms as (typeof MIGRATION_SOURCE_PMS)[number],
      actor,
    );
  }

  @Delete('credentials')
  @RequirePermissions('settings.manage')
  @ApiOperation({
    summary: 'Erase all encrypted source-PMS credentials for a property',
  })
  deleteAllCredentials(
    @Query('propertyId', new ParseUUIDPipe()) propertyId: string,
    @AuditActorCtx() actor: AuditActor,
  ) {
    return this.credentials.delete(propertyId, undefined, actor);
  }
}
