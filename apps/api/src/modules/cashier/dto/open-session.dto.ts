import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsUUID,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Open a cash drawer session/shift (KB 12.2).
 */
export class OpenSessionDto {
  @ApiProperty({ description: 'Property ID' })
  @IsUUID()
  @IsNotEmpty()
  propertyId!: string;

  @ApiProperty({ description: 'Cash drawer ID' })
  @IsUUID()
  @IsNotEmpty()
  cashDrawerId!: string;

  @ApiProperty({ description: 'Cashier (user) ID' })
  @IsUUID()
  @IsNotEmpty()
  cashierUserId!: string;

  @ApiPropertyOptional({ example: '200.00', description: 'Opening float (defaults to drawer starting float)' })
  @IsOptional()
  @IsString()
  openingFloat?: string;
}
