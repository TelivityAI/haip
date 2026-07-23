import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateArLedgerDto {
  @ApiProperty({ description: 'Property ID' })
  @IsUUID()
  @IsNotEmpty()
  propertyId!: string;

  @ApiProperty({ example: 'Acme Corp', description: 'A/R account name (KB 11.2)' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: 'NET30', description: 'Payment terms' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  paymentTermsDays?: string;

  @ApiProperty({ example: 'USD', description: 'ISO 4217 currency code' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(3)
  currencyCode!: string;

  @ApiPropertyOptional({
    description: 'Optional group/corporate profile link (KB 14.3)',
  })
  @IsOptional()
  @IsUUID()
  groupProfileId?: string;
}
