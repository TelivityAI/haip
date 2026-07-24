import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator';
import {
  REVIEW_PULL_SOURCE_NAMES,
  type ReviewPullSourceName,
} from '../review-source.interface';

export class PullReviewsDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  propertyId!: string;

  @ApiProperty({ enum: REVIEW_PULL_SOURCE_NAMES })
  @IsIn([...REVIEW_PULL_SOURCE_NAMES])
  source!: ReviewPullSourceName;

  @ApiPropertyOptional({ description: 'Google Places place_id for this property' })
  @IsOptional()
  @IsString()
  placeId?: string;

  @ApiPropertyOptional({ description: 'TripAdvisor / partner location id for this property' })
  @IsOptional()
  @IsString()
  locationId?: string;
}
