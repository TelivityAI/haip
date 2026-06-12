import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsUUID,
  IsEnum,
  IsInt,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const PAYMENT_METHODS = [
  'credit_card',
  'debit_card',
  'cash',
  'bank_transfer',
  'city_ledger',
  'vcc',
  'other',
];

export class SellProductDto {
  @ApiProperty({ description: 'Property ID (required for multi-tenancy)' })
  @IsUUID()
  @IsNotEmpty()
  propertyId!: string;

  @ApiProperty({ description: 'Product (catalog item) ID' })
  @IsUUID()
  productId!: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity?: number = 1;

  @ApiPropertyOptional({
    enum: PAYMENT_METHODS,
    description: 'If provided, take payment for the sale immediately (KB 13.3)',
  })
  @IsOptional()
  @IsEnum(PAYMENT_METHODS)
  paymentMethod?: string;
}
