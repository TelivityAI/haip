import { IsOptional, IsUUID, IsEnum, IsInt, Min, Max } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class ListPaymentsDto {
  @ApiProperty({ description: 'Property ID' })
  @IsUUID()
  propertyId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  folioId?: string;

  @ApiPropertyOptional({ enum: ['pending', 'authorized', 'captured', 'settled', 'refunded', 'partially_refunded', 'failed', 'voided'] })
  @IsOptional()
  @IsEnum(['pending', 'authorized', 'captured', 'settled', 'refunded', 'partially_refunded', 'failed', 'voided'])
  status?: string;

  @ApiPropertyOptional({
    enum: [
      'credit_card',
      'debit_card',
      'cash',
      'bank_transfer',
      'pix',
      'city_ledger',
      'vcc',
      'other',
    ],
  })
  @IsOptional()
  @IsEnum([
    'credit_card',
    'debit_card',
    'cash',
    'bank_transfer',
    'pix',
    'city_ledger',
    'vcc',
    'other',
  ])
  method?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}
