import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsUUID,
  IsBoolean,
  IsEnum,
  IsArray,
  IsInt,
  Min,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsMoneyString } from '../../../common/validation/is-money-string.validator';

export const SERVICE_CHARGE_TYPES = [
  'food_beverage',
  'minibar',
  'phone',
  'laundry',
  'parking',
  'spa',
  'incidental',
  'fee',
  'package',
  'adjustment',
] as const;

export const SERVICE_POSTING_RULES = [
  'once',
  'per_night',
  'on_consumption',
  'included_in_rate',
] as const;

export class CreateServiceDto {
  @ApiProperty({ description: 'Property ID (required for multi-tenancy)' })
  @IsUUID()
  @IsNotEmpty()
  propertyId!: string;

  @ApiProperty({ example: 'BREAKFAST' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  code!: string;

  @ApiProperty({ example: 'Breakfast Buffet' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ enum: SERVICE_CHARGE_TYPES })
  @IsEnum(SERVICE_CHARGE_TYPES)
  chargeType!: (typeof SERVICE_CHARGE_TYPES)[number];

  @ApiProperty({ example: '25.00' })
  @IsMoneyString({ allowZero: true })
  price!: string;

  @ApiProperty({ example: 'USD' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(3)
  currencyCode!: string;

  @ApiPropertyOptional({ example: 'VAT' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  taxCode?: string;

  @ApiProperty({ enum: SERVICE_POSTING_RULES })
  @IsEnum(SERVICE_POSTING_RULES)
  postingRule!: (typeof SERVICE_POSTING_RULES)[number];

  @ApiPropertyOptional({
    type: [String],
    example: ['front_desk', 'booking_engine'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  sellChannels?: string[];

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
