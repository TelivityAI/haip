import {
  IsNotEmpty,
  IsOptional,
  IsUUID,
  IsEnum,
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

/**
 * Move transactions between folios (KB 14.2) — individually (by chargeId) or in
 * bulk (by chargeType). Locked (night-audited) charges cannot move.
 */
export class MoveTransactionsDto {
  @ApiProperty({ description: 'Property ID (required for multi-tenancy)' })
  @IsUUID()
  @IsNotEmpty()
  propertyId!: string;

  @ApiProperty({ description: 'Destination folio ID' })
  @IsUUID()
  toFolioId!: string;

  @ApiPropertyOptional({ description: 'Move a single charge by ID' })
  @IsOptional()
  @IsUUID()
  chargeId?: string;

  @ApiPropertyOptional({ enum: CHARGE_TYPES, description: 'Move all charges of this type' })
  @IsOptional()
  @IsEnum(CHARGE_TYPES)
  chargeType?: string;
}
