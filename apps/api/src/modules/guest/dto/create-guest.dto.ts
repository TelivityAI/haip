import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEmail,
  IsBoolean,
  IsEnum,
  IsDateString,
  IsObject,
  MaxLength,
  Length,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateGuestDto {
  @ApiProperty({ example: 'John' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  firstName!: string;

  @ApiProperty({ example: 'Smith' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  lastName!: string;

  @ApiPropertyOptional({ example: 'john.smith@example.com' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ example: '+1-555-0100' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @ApiPropertyOptional({ example: 'passport', enum: ['passport', 'national_id', 'drivers_license'] })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  idType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(50)
  idNumber?: string;

  @ApiPropertyOptional({ example: 'US', description: 'ISO 3166-1 alpha-2' })
  @IsOptional()
  @IsString()
  @Length(2, 2)
  idCountry?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  idExpiry?: string;

  @ApiPropertyOptional({ example: 'US', description: 'ISO 3166-1 alpha-2' })
  @IsOptional()
  @IsString()
  @Length(2, 2)
  nationality?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;

  @ApiPropertyOptional({ example: 'male', enum: ['male', 'female', 'other'] })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  gender?: string;

  @ApiPropertyOptional({ example: 'Engineer' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  profession?: string;

  @ApiPropertyOptional({ example: '123.456.789-00', description: 'Generic tax or national ID (CPF, SSN, NIF, etc.)' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  taxId?: string;

  @ApiPropertyOptional({ example: { idIssuer: 'SSP', idIssuerState: 'SP', neighborhood: 'Centro' }, description: 'Jurisdiction-specific registration extension' })
  @IsOptional()
  @IsObject()
  registrationData?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  addressLine1?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  addressLine2?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  stateProvince?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  postalCode?: string;

  @ApiPropertyOptional({ example: 'US' })
  @IsOptional()
  @IsString()
  @Length(2, 2)
  countryCode?: string;

  @ApiPropertyOptional({ enum: ['none', 'silver', 'gold', 'platinum', 'diamond'], default: 'none' })
  @IsOptional()
  @IsEnum(['none', 'silver', 'gold', 'platinum', 'diamond'])
  vipLevel?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  companyName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(50)
  loyaltyNumber?: string;

  @ApiPropertyOptional({ example: { bedType: 'king', floor: 'high', smoking: 'no' } })
  @IsOptional()
  @IsObject()
  preferences?: Record<string, string>;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  gdprConsentMarketing?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}
