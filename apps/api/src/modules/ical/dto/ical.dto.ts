import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsSafeHttpUrl } from '../../../common/security/is-safe-url.validator';

export const ICAL_FEED_DIRECTIONS = ['import', 'export'] as const;

export class CreateIcalFeedDto {
  @ApiProperty()
  @IsUUID()
  propertyId!: string;

  @ApiProperty()
  @IsUUID()
  roomTypeId!: string;

  @ApiProperty({ enum: ICAL_FEED_DIRECTIONS })
  @IsEnum(ICAL_FEED_DIRECTIONS)
  direction!: (typeof ICAL_FEED_DIRECTIONS)[number];

  @ApiProperty({ example: 'Airbnb Standard King calendar' })
  @IsString()
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional({ example: 'https://calendar.example.com/feed.ics' })
  @IsOptional()
  @IsSafeHttpUrl()
  sourceUrl?: string;
}

export class UpdateIcalFeedDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ example: 'https://calendar.example.com/feed.ics' })
  @IsOptional()
  @IsSafeHttpUrl()
  sourceUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class ListIcalFeedsDto {
  @ApiProperty()
  @IsUUID()
  propertyId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  roomTypeId?: string;

  @ApiPropertyOptional({ enum: ICAL_FEED_DIRECTIONS })
  @IsOptional()
  @IsEnum(ICAL_FEED_DIRECTIONS)
  direction?: (typeof ICAL_FEED_DIRECTIONS)[number];
}

export class ListIcalBlocksDto {
  @ApiProperty()
  @IsUUID()
  propertyId!: string;

  @ApiPropertyOptional({ example: '2026-09-01' })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({ example: '2026-09-04' })
  @IsOptional()
  @IsDateString()
  endDate?: string;
}
