import {
  IsDateString,
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const WAITLIST_STATUSES = ['active', 'offered', 'converted', 'cancelled', 'expired'] as const;

export class CreateWaitlistEntryDto {
  @ApiProperty()
  @IsUUID()
  propertyId!: string;

  @ApiProperty({ example: '2026-09-01' })
  @IsDateString()
  arrivalDate!: string;

  @ApiProperty({ example: '2026-09-04' })
  @IsDateString()
  departureDate!: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  roomsRequested?: number;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  adults?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  children?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  roomTypeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  ratePlanId?: string;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  priority?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  guestName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  contactEmail?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(50)
  contactPhone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateWaitlistEntryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  arrivalDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  departureDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  roomsRequested?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  adults?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  children?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  roomTypeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  ratePlanId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  priority?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  guestName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  contactEmail?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(50)
  contactPhone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

export class ListWaitlistEntriesDto {
  @ApiProperty()
  @IsUUID()
  propertyId!: string;

  @ApiPropertyOptional({ enum: WAITLIST_STATUSES })
  @IsOptional()
  @IsEnum(WAITLIST_STATUSES)
  status?: (typeof WAITLIST_STATUSES)[number];
}

export class OfferWaitlistEntryDto {
  @ApiPropertyOptional({ example: '2026-09-01T18:00:00.000Z' })
  @IsOptional()
  @IsDateString()
  offerExpiresAt?: string;
}
