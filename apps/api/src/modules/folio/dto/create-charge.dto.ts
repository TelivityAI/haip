import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsUUID,
  IsEnum,
  IsBoolean,
  IsDateString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsMoneyString } from '../../../common/validation/is-money-string.validator';

export class CreateChargeDto {
  @ApiProperty({ description: 'Property ID' })
  @IsUUID()
  @IsNotEmpty()
  propertyId!: string;

  @ApiProperty({
    enum: ['room', 'tax', 'food_beverage', 'minibar', 'phone', 'laundry', 'parking', 'spa', 'incidental', 'fee', 'adjustment', 'package'],
  })
  @IsEnum(['room', 'tax', 'food_beverage', 'minibar', 'phone', 'laundry', 'parking', 'spa', 'incidental', 'fee', 'adjustment', 'package'])
  type!: string;

  @ApiProperty({ example: 'Room charge - Standard King' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  description!: string;

  @ApiProperty({ example: '150.00', description: 'Charge amount (positive for charges, negative for credits)' })
  // Must be a valid numeric decimal; negatives are allowed here at the DTO layer
  // because credits/adjustments are legitimate — the service restricts WHEN a
  // negative is permitted (only type='adjustment' or reversals).
  @IsMoneyString({ allowNegative: true })
  amount!: string;

  @ApiProperty({ example: 'USD' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(3)
  currencyCode!: string;

  @ApiPropertyOptional({ example: '13.13', description: 'Tax amount' })
  @IsOptional()
  @IsMoneyString({ allowZero: true }) // tax can be 0 but never negative
  taxAmount?: string;

  @ApiPropertyOptional({ example: '0.0875', description: 'Tax rate (e.g., 0.0875 for 8.75%)' })
  @IsOptional()
  @IsString()
  taxRate?: string;

  @ApiPropertyOptional({ example: 'OCCUPANCY', description: 'Tax code' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  taxCode?: string;

  @ApiProperty({ description: 'Date the charge applies to' })
  @IsDateString()
  serviceDate!: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isReversal?: boolean;

  @ApiPropertyOptional({ description: 'Original charge ID (required if isReversal=true)' })
  @IsOptional()
  @IsUUID()
  @ValidateIf((o) => o.isReversal === true)
  originalChargeId?: string;

  @ApiPropertyOptional({ description: 'Staff user ID who posted this charge' })
  @IsOptional()
  @IsUUID()
  postedBy?: string;

  // Tax calculation context (not stored, used by TaxService)
  @IsOptional()
  @IsUUID()
  guestId?: string;

  @IsOptional()
  numberOfNights?: number;

  @IsOptional()
  nightNumber?: number;

  @IsOptional()
  @IsBoolean()
  skipTaxCalculation?: boolean;
}
