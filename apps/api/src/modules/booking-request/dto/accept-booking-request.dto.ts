import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { IsMoneyString } from '../../../common/validation/is-money-string.validator';

const BOOKING_REQUEST_PRICE_SOURCES = ['submitted', 'current', 'custom'] as const;

export class AcceptBookingRequestDto {
  @ApiProperty({ enum: BOOKING_REQUEST_PRICE_SOURCES })
  @IsEnum(BOOKING_REQUEST_PRICE_SOURCES)
  priceSource!: (typeof BOOKING_REQUEST_PRICE_SOURCES)[number];

  @ApiPropertyOptional({ example: '240.00' })
  @IsOptional()
  @IsMoneyString()
  customTotal?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  customReason?: string;
}
