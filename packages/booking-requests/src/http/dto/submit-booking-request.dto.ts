import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  ArrayUnique,
  IsBoolean,
  IsEmail,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  IsAfterCheckIn,
  IsCanonicalCalendarDate,
} from '../../domain/booking-request-date.validator.js';

/**
 * Public Booking Request input. Property scope and every persisted price/card
 * detail are resolved by the server; the client supplies only selection,
 * application, consent, and a SetupIntent reference.
 */
export class SubmitBookingRequestDto {
  @ApiProperty({
    description: 'Stable client-generated identifier for replay-safe submission.',
    example: 'booking-widget-attempt-018f5f0c',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  idempotencyKey!: string;

  @ApiProperty()
  @IsUUID()
  roomTypeId!: string;

  @ApiProperty()
  @IsUUID()
  ratePlanId!: string;

  @ApiProperty({ example: '2026-10-01' })
  @IsCanonicalCalendarDate()
  checkIn!: string;

  @ApiProperty({ example: '2026-10-03' })
  @IsCanonicalCalendarDate()
  @IsAfterCheckIn()
  checkOut!: string;

  @ApiProperty({ example: 'Ada' })
  @IsString()
  @MaxLength(100)
  guestFirstName!: string;

  @ApiProperty({ example: 'Lovelace' })
  @IsString()
  @MaxLength(100)
  guestLastName!: string;

  @ApiProperty({ example: 'ada@example.com' })
  @IsEmail()
  @MaxLength(255)
  guestEmail!: string;

  @ApiPropertyOptional({ example: '+34 600 000 000' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  guestPhone?: string;

  @ApiProperty({ example: 2 })
  @IsInt()
  @Min(1)
  adults!: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  children?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  specialRequests?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  serviceIds?: string[];

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description: 'Answers keyed by the stable configured question id.',
  })
  @IsObject()
  applicationAnswers!: Record<string, unknown>;

  @ApiPropertyOptional({
    description: 'Successful SetupIntent identifier; no raw card data or card metadata.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  setupIntentId?: string;

  @ApiPropertyOptional({
    description: 'Must be true when a payment method is supplied.',
  })
  @IsOptional()
  @IsBoolean()
  consentAccepted?: boolean;

  @ApiPropertyOptional({
    description: 'Exact consent copy displayed when the payment method was saved.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  consentText?: string;

  @ApiPropertyOptional({
    description: 'Version of the displayed saved-payment-method consent.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  consentVersion?: string;
}
