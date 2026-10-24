import {
  IsBoolean,
  IsDateString,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class GuestPreRegisterDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  registrationSigned?: boolean;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional()
  @IsObject()
  registrationData?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(30)
  idType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(50)
  idNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2)
  idCountry?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  idExpiry?: string;

  /** Base64 data-URL or raw base64 of the ID photo (phone capture). */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  idImageBase64?: string;
}

export class GuestPayDto {
  @ApiProperty({ description: 'Amount to charge (folio balance or deposit)' })
  @IsNumber()
  @Min(0.01)
  amount!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  paymentMethodId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  gatewayPaymentToken?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  gatewayProvider?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4)
  cardLastFour?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  cardBrand?: string;
}

export class GuestAcceptUpsellDto {
  @ApiProperty({ description: 'Campaign id from property settings.upsellCampaigns' })
  @IsString()
  @MaxLength(80)
  campaignId!: string;
}

export class IssueCheckInLinkDto {
  @ApiProperty()
  @IsUUID()
  propertyId!: string;

  @ApiProperty()
  @IsUUID()
  reservationId!: string;

  @ApiPropertyOptional({ description: 'Token TTL in seconds (default 14 days)' })
  @IsOptional()
  @IsNumber()
  @Min(60)
  ttlSeconds?: number;
}
