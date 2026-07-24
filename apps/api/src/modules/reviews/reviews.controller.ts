import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/roles.decorator';
import { PullReviewsDto } from './dto/pull-reviews.dto';
import { ReviewsService } from './reviews.service';

@ApiTags('reviews')
@Controller('reviews')
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @Post('pull')
  @Roles('admin', 'front_desk')
  @ApiOperation({
    summary: 'Pull guest reviews from an external source (Google or TripAdvisor)',
  })
  pull(@Body() dto: PullReviewsDto) {
    return this.reviewsService.pullReviews(dto.propertyId, dto.source, {
      placeId: dto.placeId,
      locationId: dto.locationId,
    });
  }
}
