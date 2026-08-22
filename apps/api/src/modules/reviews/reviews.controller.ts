import { Body, Controller, Post, Query, ParseUUIDPipe } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/roles.decorator';
import { RequirePermissions } from '../auth/permissions.decorator';
import { PullReviewsDto } from './dto/pull-reviews.dto';
import { ReviewsService } from './reviews.service';

@ApiTags('reviews')
@Controller('reviews')
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @Post('pull')
  @RequirePermissions('reviews.manage')
  @ApiOperation({
    summary:
      'Pull guest reviews from an external source (Google, TripAdvisor, or Wave 3 reputation packs)',
  })
  pull(@Body() dto: PullReviewsDto) {
    return this.reviewsService.pullReviews(dto.propertyId, dto.source, {
      placeId: dto.placeId,
      locationId: dto.locationId,
    });
  }

  @Post('ingest')
  @Roles('admin', 'general_manager', 'night_auditor')
  @ApiOperation({
    summary: 'Scheduled review ingest for a property',
    description:
      'Pulls configured review sources (Google, TripAdvisor) and persists with dedupe. ' +
      'Called by external cron hourly — no in-process scheduler.',
  })
  @ApiQuery({ name: 'propertyId', type: String })
  ingestScheduled(@Query('propertyId', ParseUUIDPipe) propertyId: string) {
    return this.reviewsService.ingestScheduled(propertyId);
  }
}
