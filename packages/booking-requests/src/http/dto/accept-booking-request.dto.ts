import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { IsMoneyString } from '@telivityhaip/shared';

const BOOKING_REQUEST_PRICE_SOURCES = ['submitted', 'current', 'custom'] as const;

export class AcceptBookingRequestDto {
  @ApiProperty({ enum: BOOKING_REQUEST_PRICE_SOURCES })
  @IsEnum(BOOKING_REQUEST_PRICE_SOURCES)
  priceSource!: (typeof BOOKING_REQUEST_PRICE_SOURCES)[number];

  @ApiProperty({ description: 'Opaque fingerprint returned by the latest acceptance preview' })
  @IsString()
  @Matches(/^v1:[a-f0-9]{64}$/)
  previewToken!: string;

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
