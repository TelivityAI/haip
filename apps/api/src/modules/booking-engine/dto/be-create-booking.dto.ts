import {
  IsArray,
  IsDateString,
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Create a direct booking. The server RE-QUOTES authoritatively — no price is
 * accepted from the client. `propertyId` is pinned from the booking-key principal.
 */
export class BeCreateBookingDto {
  @ApiProperty()
  @IsUUID()
  roomTypeId!: string;

  @ApiProperty()
  @IsUUID()
  ratePlanId!: string;

  @ApiProperty({ example: '2026-07-01' })
  @IsDateString()
  checkIn!: string;

  @ApiProperty({ example: '2026-07-04' })
  @IsDateString()
  checkOut!: string;

  // --- Guest ---
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

  @ApiPropertyOptional({ example: '+1-555-0100' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  guestPhone?: string;

  // --- Occupancy ---
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

  // --- Payment (tokenized; NEVER raw card data) ---
  @ApiPropertyOptional({
    description:
      'Stripe PaymentMethod/token from the widget. Required when the property deposit policy is not "none".',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  paymentToken?: string;

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

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  serviceIds?: string[];
}
