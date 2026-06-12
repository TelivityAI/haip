import { IsNotEmpty, IsOptional, IsUUID, IsEnum } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Correction matrix (KB 14.1). The legal correction op is derived from payment
 * state; an optional override must match the legal op or it is rejected.
 */
export class CorrectPaymentDto {
  @ApiProperty({ description: 'Property ID (required for multi-tenancy)' })
  @IsUUID()
  @IsNotEmpty()
  propertyId!: string;

  @ApiPropertyOptional({
    enum: ['void', 'refund', 'adjust'],
    description: 'Optional op override; must be the legal op for the payment state',
  })
  @IsOptional()
  @IsEnum(['void', 'refund', 'adjust'])
  op?: 'void' | 'refund' | 'adjust';
}
