import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsUUID,
  IsEnum,
  IsNumberString,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreatePaymentDto {
  @ApiProperty({ description: 'Folio ID' })
  @IsUUID()
  @IsNotEmpty()
  folioId!: string;

  @ApiProperty({ description: 'Property ID' })
  @IsUUID()
  @IsNotEmpty()
  propertyId!: string;

  @ApiProperty({ enum: ['credit_card', 'debit_card', 'cash', 'bank_transfer', 'city_ledger', 'vcc', 'other'] })
  @IsEnum(['credit_card', 'debit_card', 'cash', 'bank_transfer', 'city_ledger', 'vcc', 'other'])
  method!: string;

  @ApiProperty({ example: '150.00' })
  @IsNumberString({}, { message: 'amount must be a numeric decimal string' })
  @IsNotEmpty()
  amount!: string;

  @ApiProperty({ example: 'USD' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(3)
  currencyCode!: string;

  @ApiPropertyOptional({ example: 'stripe' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  gatewayProvider?: string;

  @ApiPropertyOptional({ description: 'Tokenized card reference (NEVER raw card data)' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  gatewayPaymentToken?: string;

  @ApiPropertyOptional({ example: '4242', description: 'Last 4 digits only' })
  @IsOptional()
  @IsString()
  @MaxLength(4)
  cardLastFour?: string;

  @ApiPropertyOptional({ example: 'visa', enum: ['visa', 'mastercard', 'amex'] })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  cardBrand?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}
