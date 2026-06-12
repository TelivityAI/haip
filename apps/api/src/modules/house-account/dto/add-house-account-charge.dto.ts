import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsUUID,
  IsEnum,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const CHARGE_TYPES = [
  'room',
  'tax',
  'food_beverage',
  'minibar',
  'phone',
  'laundry',
  'parking',
  'spa',
  'incidental',
  'fee',
  'adjustment',
  'package',
];

export class AddHouseAccountChargeDto {
  @ApiProperty({ description: 'Property ID (required for multi-tenancy)' })
  @IsUUID()
  @IsNotEmpty()
  propertyId!: string;

  @ApiPropertyOptional({
    enum: CHARGE_TYPES,
    default: 'incidental',
    description: 'House-account charges post to non-room revenue categories (KB 13.4)',
  })
  @IsOptional()
  @IsEnum(CHARGE_TYPES)
  type?: string;

  @ApiProperty({ example: 'Bottle of water' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  description!: string;

  @ApiProperty({ example: '12.50' })
  @IsString()
  @IsNotEmpty()
  amount!: string;

  @ApiProperty({ example: 'USD' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(3)
  currencyCode!: string;

  @ApiPropertyOptional({ example: '1.00' })
  @IsOptional()
  @IsString()
  taxAmount?: string;

  @ApiPropertyOptional({ example: 'VAT' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  taxCode?: string;

  @ApiPropertyOptional({ description: 'Staff user ID who posted this charge' })
  @IsOptional()
  @IsUUID()
  postedBy?: string;
}
