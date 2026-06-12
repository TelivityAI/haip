import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsUUID,
  IsEnum,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Record a cash movement on an open session (KB 12.3).
 */
export class RecordMovementDto {
  @ApiProperty({ description: 'Property ID (required for multi-tenancy)' })
  @IsUUID()
  @IsNotEmpty()
  propertyId!: string;

  @ApiProperty({ enum: ['payment', 'refund', 'paid_out', 'drop'], description: 'Movement type (KB 12.3)' })
  @IsEnum(['payment', 'refund', 'paid_out', 'drop'])
  type!: string;

  @ApiProperty({ example: '50.00', description: 'Movement amount' })
  @IsString()
  @IsNotEmpty()
  amount!: string;

  @ApiPropertyOptional({ description: 'Reservation ID (optional — KB 12.3)' })
  @IsOptional()
  @IsUUID()
  reservationId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;

  @ApiPropertyOptional({ description: 'Staff user ID recording the movement' })
  @IsOptional()
  @IsUUID()
  createdBy?: string;
}
