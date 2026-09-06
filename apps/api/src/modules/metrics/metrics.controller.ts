import { Controller, Get, Header } from '@nestjs/common';
import { ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/public.decorator';
import { MetricsService } from './metrics.service';

@ApiTags('metrics')
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Public()
  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  @ApiProduces('text/plain')
  @ApiOperation({ summary: 'Prometheus metrics (restrict to monitoring network at reverse proxy)' })
  scrape() {
    return this.metrics.render();
  }
}
