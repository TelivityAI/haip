import { Controller, Get, Query, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { SearchService } from './search.service';
import { UniversalSearchDto } from './dto/universal-search.dto';
import { PortfolioPropertyResolver } from '../reports/portfolio-property-resolver';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';

@ApiTags('search')
@Controller('search')
export class SearchController {
  constructor(
    private readonly searchService: SearchService,
    private readonly portfolioResolver: PortfolioPropertyResolver,
    private readonly configService: ConfigService,
  ) {}

  private authOn(): boolean {
    return this.configService.get<string>('AUTH_ENABLED', 'true') !== 'false';
  }

  @Get()
  @ApiOperation({ summary: 'Universal search across guests, reservations, folios, rooms, groups' })
  @ApiQuery({ name: 'q', required: true })
  @ApiQuery({ name: 'propertyId', required: true })
  @ApiQuery({ name: 'types', required: false, description: 'Comma-separated: guest,reservation,folio,room,group' })
  search(@Query() dto: UniversalSearchDto) {
    return this.searchService.search(dto.propertyId, dto.q, dto.types);
  }

  @Get('portfolio')
  @ApiOperation({ summary: 'Universal search across all accessible properties' })
  @ApiQuery({ name: 'q', required: true })
  @ApiQuery({ name: 'organizationId', required: false })
  @ApiQuery({ name: 'types', required: false })
  async searchPortfolio(
    @Query('q') q: string,
    @Query('organizationId') organizationId: string | undefined,
    @Query('types') types: string | undefined,
    @CurrentUser() user?: AuthUser,
  ) {
    const propertyIds = await this.portfolioResolver.resolvePropertyIds(
      user,
      this.authOn(),
      organizationId,
    );
    const results = await this.searchService.searchPortfolio(propertyIds, q, types);
    const names = await this.searchService.propertyNameMap(propertyIds);
    return results.map((r) => ({
      ...r,
      propertyName: names.get(r.propertyId),
    }));
  }
}
