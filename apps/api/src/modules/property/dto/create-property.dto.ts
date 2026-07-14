import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsInt,
  Min,
  Max,
  IsBoolean,
  IsEmail,
  MaxLength,
  Length,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreatePropertyDto {
  @ApiProperty({ example: 'Grand Hotel NYC' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;

  @ApiProperty({ example: 'HTLNYC01', description: 'Unique property code' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  code!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

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

  @ApiProperty({ example: 'US', description: 'ISO 3166-1 alpha-2' })
  @IsString()
  @IsNotEmpty()
  @Length(2, 2)
  countryCode!: string;

  @ApiProperty({ example: 'America/New_York', description: 'IANA timezone' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  timezone!: string;

  @ApiProperty({ example: 'USD', description: 'ISO 4217 currency code' })
  @IsString()
  @IsNotEmpty()
  @Length(3, 3)
  currencyCode!: string;

  @ApiPropertyOptional({ example: 'en', description: 'BCP 47 language code' })
  @IsOptional()
  @IsString()
  @MaxLength(5)
  defaultLanguage?: string;

  @ApiPropertyOptional({ example: 4, minimum: 1, maximum: 5 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  starRating?: number;

  @ApiProperty({ example: 200 })
  @IsInt()
  @Min(1)
  totalRooms!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  website?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  taxJurisdiction?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  guestRegistrationRequired?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  guestRegistrationConfig?: Record<string, unknown>;

  @ApiPropertyOptional({ example: '15:00' })
  @IsOptional()
  @IsString()
  @MaxLength(5)
  checkInTime?: string;

  @ApiPropertyOptional({ example: '11:00' })
  @IsOptional()
  @IsString()
  @MaxLength(5)
  checkOutTime?: string;

  @ApiPropertyOptional({ example: 5, minimum: 0, maximum: 100 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  overbookingPercentage?: number;

  @ApiPropertyOptional({ description: 'Staff dashboard display name (white-label)' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  staffDisplayName?: string;

  @ApiPropertyOptional({ description: 'Media UUID for staff dashboard logo' })
  @IsOptional()
  @IsString()
  staffLogoMediaId?: string;

  @ApiPropertyOptional({ example: '#06bdb4' })
  @IsOptional()
  @IsString()
  @MaxLength(9)
  staffPrimaryColor?: string;

  @ApiPropertyOptional({ example: '#016491' })
  @IsOptional()
  @IsString()
  @MaxLength(9)
  staffAccentColor?: string;

  @ApiPropertyOptional({ description: 'Flexible property settings including kpiThresholds' })
  @IsOptional()
  settings?: Record<string, unknown>;
}
