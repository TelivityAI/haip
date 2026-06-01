import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsUUID,
  IsEnum,
  MaxLength,
} from 'class-validator';
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

export class AddHouseAccountPaymentDto {
  @ApiProperty({ description: 'Property ID (required for multi-tenancy)' })
  @IsUUID()
  @IsNotEmpty()
  propertyId!: string;

  @ApiProperty({ enum: PAYMENT_METHODS, example: 'cash' })
  @IsEnum(PAYMENT_METHODS)
  method!: string;

  @ApiProperty({ example: '12.50' })
  @IsString()
  @IsNotEmpty()
  amount!: string;

  @ApiProperty({ example: 'USD' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(3)
  currencyCode!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}
