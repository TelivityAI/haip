import {
  IsOptional,
  IsUUID,
  IsIn,
  IsDateString,
  IsInt,
  IsBooleanString,
  Min,
  Max,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

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
] as const;

/**
 * Property-wide charge ledger query. Distinct from ListChargesDto (one folio): this
 * answers "what charges, reversals and corrections hit this property in a window",
 * which is a different question from "what is on this guest's bill".
 */
export class ListPropertyChargesDto {
  @ApiProperty({ description: 'Property ID' })
  @IsUUID()
  propertyId!: string;

  @ApiPropertyOptional({ enum: CHARGE_TYPES })
  @IsOptional()
  @IsIn(CHARGE_TYPES)
  type?: string;

  @ApiPropertyOptional({
    description:
      'true = only reversals / corrections: is_reversal, an amendment-linked adjustment, ' +
      "type 'adjustment', or a negative amount",
  })
  @IsOptional()
  @IsBooleanString()
  reversalsOnly?: string;

  @ApiPropertyOptional({ description: 'Inclusive service-date lower bound (YYYY-MM-DD)' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ description: 'Inclusive service-date upper bound (YYYY-MM-DD)' })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({ description: 'Restrict to a single folio' })
  @IsOptional()
  @IsUUID()
  folioId?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 50;
}
