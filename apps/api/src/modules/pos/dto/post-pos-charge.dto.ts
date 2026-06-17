import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsUUID,
  IsEnum,
  IsDateString,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsMoneyString } from '../../../common/validation/is-money-string.validator';

/**
 * Charge types a Point-of-Sale outlet (restaurant, bar, spa, parking) is allowed
 * to post to a guest folio. Deliberately EXCLUDES 'room', 'tax', and 'adjustment'
 * — those are PMS-internal and must never originate from an external POS terminal.
 */
export const POS_CHARGE_TYPES = [
  'food_beverage',
  'minibar',
  'phone',
  'laundry',
  'parking',
  'spa',
  'incidental',
  'fee',
] as const;

export class PostPosChargeDto {
  /**
   * Optional in the body: for a property-scoped API key it is pinned from the
   * credential by the controller (confused-deputy safe). Only a platform-scoped
   * caller supplies it explicitly.
   */
  @ApiPropertyOptional({ description: 'Property ID — pinned from the API key for property-scoped callers' })
  @IsOptional()
  @IsUUID()
  propertyId?: string;

  @ApiProperty({ description: 'Target folio to post the charge to' })
  @IsUUID()
  @IsNotEmpty()
  folioId!: string;

  @ApiProperty({ enum: POS_CHARGE_TYPES, example: 'food_beverage' })
  @IsEnum(POS_CHARGE_TYPES)
  type!: (typeof POS_CHARGE_TYPES)[number];

  @ApiProperty({ example: 'Dinner — Oceanfront Grill (check #4821)' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  description!: string;

  @ApiProperty({ example: '84.50', description: 'Positive charge amount' })
  @IsMoneyString()
  amount!: string;

  @ApiProperty({ example: 'USD' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(3)
  currencyCode!: string;

  @ApiProperty({ description: 'Date the charge applies to (service date)' })
  @IsDateString()
  serviceDate!: string;

  @ApiPropertyOptional({ description: 'External POS reference / check number' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  reference?: string;
}
