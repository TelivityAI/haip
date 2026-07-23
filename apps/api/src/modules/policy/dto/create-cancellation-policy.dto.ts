import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsUUID,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumberString,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export const CANCELLATION_PENALTY_TYPES = [
  'none',
  'first_night',
  'percentage',
  'full',
] as const;

export const CANCELLATION_DEPOSIT_HANDLINGS = [
  'refund_if_refundable',
  'always_forfeit',
  'always_refund',
] as const;

export class CreateCancellationPolicyDto {
  @ApiProperty({ description: 'Property ID (required for multi-tenancy)' })
  @IsUUID()
  @IsNotEmpty()
  propertyId!: string;

  @ApiProperty({ example: 'Flexible' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @ApiProperty({ example: 'FLEX-24' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  code!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ default: 24, description: 'Hours before arrival for free cancel' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  freeCancelHoursBeforeArrival?: number;

  @ApiPropertyOptional({ enum: CANCELLATION_PENALTY_TYPES, default: 'first_night' })
  @IsOptional()
  @IsEnum(CANCELLATION_PENALTY_TYPES)
  penaltyType?: (typeof CANCELLATION_PENALTY_TYPES)[number];

  @ApiPropertyOptional({ example: '50.00', description: 'Required when penaltyType=percentage' })
  @IsOptional()
  @IsNumberString()
  penaltyPercentage?: string;

  @ApiPropertyOptional({
    enum: CANCELLATION_DEPOSIT_HANDLINGS,
    default: 'refund_if_refundable',
  })
  @IsOptional()
  @IsEnum(CANCELLATION_DEPOSIT_HANDLINGS)
  depositHandling?: (typeof CANCELLATION_DEPOSIT_HANDLINGS)[number];

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
