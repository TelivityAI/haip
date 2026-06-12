import { IsUUID, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Transfer an outstanding folio balance into an A/R ledger (KB 11.3).
 */
export class TransferToArDto {
  @ApiProperty({ description: 'Property ID (required for multi-tenancy)' })
  @IsUUID()
  @IsNotEmpty()
  propertyId!: string;

  @ApiProperty({ description: 'Source folio whose balance is transferred' })
  @IsUUID()
  @IsNotEmpty()
  folioId!: string;

  @ApiProperty({ description: 'Destination A/R ledger' })
  @IsUUID()
  @IsNotEmpty()
  arLedgerId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;

  @ApiPropertyOptional({ description: 'Staff user ID performing the transfer' })
  @IsOptional()
  @IsUUID()
  createdBy?: string;
}
