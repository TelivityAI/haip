import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator';

export class PullReviewsDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  propertyId!: string;

  @ApiProperty({ enum: ['google', 'tripadvisor'] })
  @IsIn(['google', 'tripadvisor'])
  source!: 'google' | 'tripadvisor';

  @ApiPropertyOptional({ description: 'Google Places place_id for this property' })
  @IsOptional()
  @IsString()
  placeId?: string;

  @ApiPropertyOptional({ description: 'TripAdvisor location id for this property' })
  @IsOptional()
  @IsString()
  locationId?: string;
}
