import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsUUID,
  IsEnum,
  IsBoolean,
  IsInt,
  IsNumber,
  IsArray,
  IsDateString,
  MaxLength,
  Length,
  ValidateIf,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateRatePlanDto {
  @ApiProperty()
  @IsUUID()
  propertyId!: string;

  @ApiProperty()
  @IsUUID()
  roomTypeId!: string;

  @ApiProperty({ example: 'Best Available Rate' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @ApiProperty({ example: 'BAR1' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  code!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ enum: ['bar', 'derived', 'negotiated', 'package', 'promotional'] })
  @IsEnum(['bar', 'derived', 'negotiated', 'package', 'promotional'])
  type!: string;

  @ApiProperty({ example: '199.99' })
  @IsString()
  @IsNotEmpty()
  baseAmount!: string;

  @ApiProperty({ example: 'USD' })
  @IsString()
  @IsNotEmpty()
  @Length(3, 3)
  currencyCode!: string;

  @ApiPropertyOptional({ description: 'Parent rate plan ID (required for derived type)' })
  @IsOptional()
  @IsUUID()
  @ValidateIf((o) => o.type === 'derived')
  parentRatePlanId?: string;

  @ApiPropertyOptional({ enum: ['percentage', 'fixed'] })
  @IsOptional()
  @IsEnum(['percentage', 'fixed'])
  @ValidateIf((o) => o.type === 'derived')
  derivedAdjustmentType?: string;

  @ApiPropertyOptional({ example: '-10.00', description: 'Negative = discount, positive = surcharge' })
  @IsOptional()
  @IsString()
  @ValidateIf((o) => o.type === 'derived')
  derivedAdjustmentValue?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isTaxInclusive?: boolean;

  @ApiPropertyOptional({ enum: ['room_only', 'breakfast', 'half_board', 'full_board', 'all_inclusive'] })
  @IsOptional()
  @IsEnum(['room_only', 'breakfast', 'half_board', 'full_board', 'all_inclusive'])
  mealPlan?: string;

  @ApiPropertyOptional({ example: '2024-01-01' })
  @IsOptional()
  @IsDateString()
  validFrom?: string;

  @ApiPropertyOptional({ example: '2024-12-31' })
  @IsOptional()
  @IsDateString()
  validTo?: string;

  @ApiPropertyOptional({ example: ['booking.com', 'expedia'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  channelCodes?: string[];

  @ApiPropertyOptional({ description: 'Linked cancellation policy ID' })
  @IsOptional()
  @IsUUID()
  cancellationPolicyId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  sortOrder?: number;
}
