import {
  IsArray,
  IsBoolean,
  IsHexColor,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class DepositPolicyDto {
  @ApiProperty({ enum: ['none', 'first_night', 'percentage', 'full'] })
  @IsIn(['none', 'first_night', 'percentage', 'full'])
  type!: 'none' | 'first_night' | 'percentage' | 'full';

  @ApiPropertyOptional({ description: 'Required when type=percentage', minimum: 0, maximum: 100 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  percentage?: number;

  @ApiProperty()
  @IsBoolean()
  refundable!: boolean;
}

/** Admin: create a publishable booking key. */
export class CreateBookingKeyDto {
  @ApiProperty({ example: 'Website widget' })
  @IsString()
  @MaxLength(200)
  label!: string;
}

/** Admin: update per-property booking engine config. */
export class UpdateBookingEngineConfigDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  displayName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  logoMediaId?: string;

  @ApiPropertyOptional({ example: '#0F172A' })
  @IsOptional()
  @IsHexColor()
  primaryColor?: string;

  @ApiPropertyOptional({ example: '#2563EB' })
  @IsOptional()
  @IsHexColor()
  accentColor?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  sellableRoomTypeIds?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  sellableRatePlanIds?: string[];

  @ApiPropertyOptional({ type: DepositPolicyDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => DepositPolicyDto)
  depositPolicy?: DepositPolicyDto;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  autoConfirm?: boolean;

  @ApiPropertyOptional({ description: 'Stripe PUBLISHABLE key (safe to expose)' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  stripePublishableKey?: string;
}
