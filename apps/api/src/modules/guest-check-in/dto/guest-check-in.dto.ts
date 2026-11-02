import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class GuestPreRegisterDto {
  /**
   * Fallback when no digital signature image is captured (e.g. paper sign at desk).
   * Prefer `signatureImageBase64` for online check-in — that sets registrationSignedAt.
   */
  @ApiPropertyOptional({
    description:
      'Fallback: guest signed on paper / no digital pad. Prefer signatureImageBase64 for online.',
  })
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

  /** Base64 data-URL or raw base64 of the registration signature (canvas pad). */
  @ApiPropertyOptional({
    description: 'PNG/JPEG data-URL of the guest signature pad capture',
  })
  @IsOptional()
  @IsString()
  signatureImageBase64?: string;

  @ApiPropertyOptional({ enum: ['online', 'front_desk'], default: 'online' })
  @IsOptional()
  @IsIn(['online', 'front_desk'])
  capturedVia?: 'online' | 'front_desk';
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

  /** Browser return URL after Redsys/Worldline hosted redirect (back to /check-in). */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  returnUrl?: string;
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

  @ApiPropertyOptional({ description: 'Token TTL in seconds (default 48 hours, max 7 days)' })
  @IsOptional()
  @IsNumber()
  @Min(60)
  @Max(7 * 24 * 60 * 60)
  ttlSeconds?: number;
}

export class RequestCheckInLinkDto {
  @ApiProperty({ description: 'Property id (scopes confirmation lookup to this hotel)' })
  @IsUUID()
  propertyId!: string;

  @ApiProperty({ description: 'Reservation confirmation number' })
  @IsString()
  @MaxLength(40)
  confirmationNumber!: string;

  @ApiProperty({ description: 'Guest email on the reservation' })
  @IsString()
  @MaxLength(255)
  email!: string;
}
