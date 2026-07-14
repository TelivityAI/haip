import { Controller, Get, Post, Body, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { HelpService } from './help.service';
import { HelpExplainDto } from './dto/help-explain.dto';

@ApiTags('help')
@Controller('help')
export class HelpController {
  constructor(private readonly helpService: HelpService) {}

  @Get()
  @ApiOperation({
    summary: 'Public contextual help for a dashboard route (OSS-safe copy only)',
  })
  @ApiQuery({ name: 'route', required: true, example: '/night-audit' })
  getHelp(@Query('route') route: string) {
    return this.helpService.getForRoute(route || '/');
  }

  @Get('routes')
  @ApiOperation({ summary: 'List routes that have help entries' })
  listRoutes() {
    return this.helpService.listRoutes();
  }

  @Post('explain')
  @ApiOperation({
    summary: 'Optional grounded AI explain for screen numeric facts (no KB text)',
  })
  explain(@Body() dto: HelpExplainDto) {
    return this.helpService.explain(dto.route, dto.facts ?? {});
  }
}
