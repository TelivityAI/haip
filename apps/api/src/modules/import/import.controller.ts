import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Header,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Roles } from '../auth/roles.decorator';
import { RequirePermissions } from '../auth/permissions.decorator';
import { ImportService } from './import.service';
import { ImportRequestDto } from './dto/import-request.dto';

/**
 * Data migration / bulk import — `/api/v1/import/*`. Staff-facing (Keycloak-gated,
 * `settings.manage`). `propertyId` is a required, UUID-validated query param on the
 * import route (multi-tenancy: every created row is scoped to it). The on-ramp for
 * hotels switching from another PMS.
 */
@ApiTags('import')
@Controller('import')
@Roles('admin')
export class ImportController {
  constructor(private readonly importService: ImportService) {}

  @Get('entities')
  @RequirePermissions('settings.manage')
  @ApiOperation({ summary: 'List importable entities and their template columns' })
  listEntities() {
    return this.importService.listEntities();
  }

  @Get('templates/:entity')
  @RequirePermissions('settings.manage')
  @Header('Content-Type', 'text/csv')
  @ApiOperation({ summary: 'Download a CSV header template for an entity' })
  template(@Param('entity') entity: string) {
    return this.importService.template(entity);
  }

  @Post(':entity')
  @RequirePermissions('settings.manage')
  @ApiOperation({ summary: 'Import rows for an entity (dryRun to validate first)' })
  run(
    @Param('entity') entity: string,
    @Query('propertyId', new ParseUUIDPipe()) propertyId: string,
    @Body() dto: ImportRequestDto,
  ) {
    return this.importService.run(propertyId, entity, dto);
  }
}
