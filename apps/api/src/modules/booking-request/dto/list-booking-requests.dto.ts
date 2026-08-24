import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const BOOKING_REQUEST_STATUSES = ['pending', 'accepted', 'denied'] as const;

export class ListBookingRequestsDto {
  @ApiProperty({ description: 'Property ID (required for tenant scoping)' })
  @IsUUID()
  propertyId!: string;

  @ApiPropertyOptional({ enum: BOOKING_REQUEST_STATUSES })
  @IsOptional()
  @IsEnum(BOOKING_REQUEST_STATUSES)
  status?: (typeof BOOKING_REQUEST_STATUSES)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  arrivalDateFrom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  arrivalDateTo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  departureDateFrom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  departureDateTo?: string;

  @ApiPropertyOptional({ description: 'Case-insensitive name or email search' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  guest?: string;

  @ApiPropertyOptional({ type: Boolean })
  @IsOptional()
  @Transform(({ value }) => value === 'true' ? true : value === 'false' ? false : value)
  @IsBoolean()
  hasCard?: boolean;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}
