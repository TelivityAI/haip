import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { IsMoneyString } from '../../../common/validation/is-money-string.validator';
import { IsCanonicalCalendarDate } from '../booking-request-date.validator';

const STAY_AMENDMENT_PRICE_SOURCES = ['prior', 'current', 'custom'] as const;

class BookingRequestStayAmendmentDatesDto {
  @ApiProperty({ example: '2026-10-01' })
  @IsCanonicalCalendarDate()
  arrivalDate!: string;

  @ApiProperty({ example: '2026-10-04' })
  @IsCanonicalCalendarDate()
  departureDate!: string;
}

export class PreviewBookingRequestStayAmendmentDto extends BookingRequestStayAmendmentDatesDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  propertyId!: string;
}

export class AmendBookingRequestStayDto extends BookingRequestStayAmendmentDatesDto {
  @ApiProperty({ enum: STAY_AMENDMENT_PRICE_SOURCES })
  @IsEnum(STAY_AMENDMENT_PRICE_SOURCES)
  priceSource!: (typeof STAY_AMENDMENT_PRICE_SOURCES)[number];

  @ApiProperty({ description: 'Opaque fingerprint returned by the latest amendment preview' })
  @IsString()
  @Matches(/^v1:[a-f0-9]{64}$/)
  previewToken!: string;

  @ApiProperty({ description: 'Durable client-generated operation key', maxLength: 200 })
  @IsString()
  @MaxLength(200)
  @Matches(/\S/)
  idempotencyKey!: string;

  @ApiPropertyOptional({ example: '420.00' })
  @IsOptional()
  @IsMoneyString()
  customTotal?: string;

  @ApiPropertyOptional({ description: 'Required when priceSource is custom' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  customReason?: string;
}
