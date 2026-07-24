import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { Public } from '../auth/public.decorator';
import {
  INTEGRATION_CATALOG_STATUSES,
  IntegrationCatalogItemDto,
  ListIntegrationsDto,
} from './dto/integration-registry.dto';
import { IntegrationsService } from './integrations.service';

@ApiTags('integrations')
@Controller('integrations/catalog')
@Public()
export class IntegrationsCatalogController {
  constructor(private readonly integrationsService: IntegrationsService) {}

  @Get()
  @ApiOperation({
    summary: 'List the public integration catalog',
    description:
      'Returns global public catalog metadata. propertyId is not required because this catalog is not tenant data.',
  })
  @ApiQuery({ name: 'category', required: false, example: 'Payments' })
  @ApiQuery({ name: 'status', required: false, enum: INTEGRATION_CATALOG_STATUSES })
  @ApiOkResponse({ type: IntegrationCatalogItemDto, isArray: true })
  list(@Query() filters: ListIntegrationsDto) {
    return this.integrationsService.listCatalog(filters);
  }

  @Get(':slug')
  @ApiOperation({
    summary: 'Get one public integration catalog item',
    description:
      'Returns global public catalog metadata. propertyId is not required because this catalog is not tenant data.',
  })
  @ApiParam({ name: 'slug', example: 'stripe' })
  @ApiOkResponse({ type: IntegrationCatalogItemDto })
  @ApiNotFoundResponse({ description: 'Integration not found' })
  getBySlug(@Param('slug') slug: string) {
    return this.integrationsService.findCatalogBySlug(slug);
  }
}
