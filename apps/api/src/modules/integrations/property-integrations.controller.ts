import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AuditActorCtx, type AuditActor } from '../../common/audit/audit-actor';
import { RequirePermissions } from '../auth/permissions.decorator';
import { Roles } from '../auth/roles.decorator';
import {
  PropertyIntegrationItemDto,
  UpsertPropertyIntegrationDto,
} from './dto/integration-registry.dto';
import {
  IntegrationsService,
  sanitizeIntegrationConfig,
} from './integrations.service';

function sanitizeItem<T extends { slug: string; config?: Record<string, unknown> | null }>(
  item: T,
): T {
  return {
    ...item,
    config: sanitizeIntegrationConfig(item.slug, item.config ?? {}),
  };
}

@ApiTags('admin')
@Controller('admin/integrations')
@Roles('admin')
export class PropertyIntegrationsController {
  constructor(private readonly integrationsService: IntegrationsService) {}

  @Get()
  @RequirePermissions('settings.manage')
  @ApiOperation({ summary: 'List catalog entries with property connection state' })
  @ApiQuery({ name: 'propertyId', required: true, type: String })
  @ApiResponse({ status: 200, type: PropertyIntegrationItemDto, isArray: true })
  async list(@Query('propertyId', new ParseUUIDPipe()) propertyId: string) {
    const rows = await this.integrationsService.listPropertyIntegrations(propertyId);
    return rows.map((row: { slug: string; config?: Record<string, unknown> | null }) => sanitizeItem(row));
  }

  @Get(':slug')
  @RequirePermissions('settings.manage')
  @ApiOperation({ summary: 'Get one catalog entry with property connection state' })
  @ApiQuery({ name: 'propertyId', required: true, type: String })
  @ApiResponse({ status: 200, type: PropertyIntegrationItemDto })
  async getOne(
    @Param('slug') slug: string,
    @Query('propertyId', new ParseUUIDPipe()) propertyId: string,
  ) {
    const row = await this.integrationsService.getPropertyIntegration(propertyId, slug);
    return sanitizeItem(row);
  }

  @Put(':slug')
  @RequirePermissions('settings.manage')
  @ApiOperation({ summary: 'Enable, disable, or configure an integration for a property' })
  @ApiQuery({ name: 'propertyId', required: true, type: String })
  @ApiResponse({ status: 200, type: PropertyIntegrationItemDto })
  async upsert(
    @Param('slug') slug: string,
    @Query('propertyId', new ParseUUIDPipe()) propertyId: string,
    @Body() dto: UpsertPropertyIntegrationDto,
    @AuditActorCtx() actor: AuditActor,
  ) {
    const row = await this.integrationsService.upsertPropertyIntegration(
      propertyId,
      slug,
      dto,
      actor,
    );
    return sanitizeItem(row);
  }
}
