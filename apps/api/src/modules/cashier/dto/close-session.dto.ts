import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsUUID,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Close a cash drawer session (KB 12.4). The cashier enters the counted balance;
 * the system computes the expected balance and variance.
 */
export class CloseSessionDto {
  @ApiProperty({ description: 'Property ID (required for multi-tenancy)' })
  @IsUUID()
  @IsNotEmpty()
  propertyId!: string;

  @ApiProperty({ example: '450.00', description: 'Physically counted cash at close' })
  @IsString()
  @IsNotEmpty()
  countedBalance!: string;

  @ApiPropertyOptional({ example: '100.00', description: 'Optional final cash drop at close' })
  @IsOptional()
  @IsString()
  dropAmount?: string;
}
