import { IsUUID, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Apply a held deposit to a reservation folio (KB 10.3). The folio to credit
 * may be supplied explicitly; otherwise the caller resolves it from the
 * reservation link on the deposit entry.
 */
export class ApplyDepositDto {
  @ApiProperty({ description: 'Property ID (required for multi-tenancy)' })
  @IsUUID()
  propertyId!: string;

  @ApiPropertyOptional({ description: 'Folio ID to credit the deposit against' })
  @IsOptional()
  @IsUUID()
  folioId?: string;
}
