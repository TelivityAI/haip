import { IsDateString, IsInt, IsOptional, IsUUID, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Firm price quote for a specific room type + rate plan + dates + occupancy. */
export class BeQuoteDto {
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

  @ApiProperty({ example: 2 })
  @IsInt()
  @Min(1)
  adults!: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  children?: number;
}
