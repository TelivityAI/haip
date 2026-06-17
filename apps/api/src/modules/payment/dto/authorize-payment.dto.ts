import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsUUID,
  IsDateString,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsMoneyString } from '../../../common/validation/is-money-string.validator';

export class AuthorizePaymentDto {
  @ApiProperty({ description: 'Folio ID' })
  @IsUUID()
  @IsNotEmpty()
  folioId!: string;

  @ApiProperty({ description: 'Property ID' })
  @IsUUID()
  @IsNotEmpty()
  propertyId!: string;

  @ApiProperty({ example: '500.00' })
  @IsMoneyString() // must be a positive decimal string
  amount!: string;

  @ApiProperty({ example: 'USD' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(3)
  currencyCode!: string;

  @ApiProperty({ example: 'stripe' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  gatewayProvider!: string;

  @ApiProperty({ description: 'Tokenized card reference (NEVER raw card data)' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  gatewayPaymentToken!: string;

  @ApiPropertyOptional({ example: '4242' })
  @IsOptional()
  @IsString()
  @MaxLength(4)
  cardLastFour?: string;

  @ApiPropertyOptional({ example: 'visa' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  cardBrand?: string;

  @ApiPropertyOptional({ description: 'Pre-auth expiry date' })
  @IsOptional()
  @IsDateString()
  preAuthExpiresAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}
