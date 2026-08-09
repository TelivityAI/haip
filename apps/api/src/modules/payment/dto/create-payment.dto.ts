import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsUUID,
  IsEnum,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsMoneyString } from '../../../common/validation/is-money-string.validator';

export class CreatePaymentDto {
  @ApiProperty({ description: 'Folio ID' })
  @IsUUID()
  @IsNotEmpty()
  folioId!: string;

  @ApiProperty({ description: 'Property ID' })
  @IsUUID()
  @IsNotEmpty()
  propertyId!: string;

  @ApiProperty({
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
    description:
      'Manual settle tender. Use credit_card/debit_card here for offline card machines (no gateway). Gateway cards must use POST /payments/authorize. pix = Brazil PIX paid direct to the property.',
  })
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
  method!: string;

  @ApiProperty({ example: '150.00' })
  @IsMoneyString() // must be a positive decimal string
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
