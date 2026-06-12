import {
  IsNotEmpty,
  IsOptional,
  IsUUID,
  IsEnum,
  IsInt,
} from 'class-validator';
import { Type } from 'class-transformer';
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

/**
 * Split-folio routing rule (KB 14.2): route a charge TYPE to a target folio for
 * a given reservation. Highest priority wins.
 */
export class CreateRoutingRuleDto {
  @ApiProperty({ description: 'Property ID (required for multi-tenancy)' })
  @IsUUID()
  @IsNotEmpty()
  propertyId!: string;

  @ApiProperty({ description: 'Reservation the rule applies to' })
  @IsUUID()
  reservationId!: string;

  @ApiProperty({ enum: CHARGE_TYPES })
  @IsEnum(CHARGE_TYPES)
  chargeType!: string;

  @ApiProperty({ description: 'Folio that charges of this type post to' })
  @IsUUID()
  targetFolioId!: string;

  @ApiPropertyOptional({ default: 0, description: 'Higher priority wins' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  priority?: number = 0;
}
