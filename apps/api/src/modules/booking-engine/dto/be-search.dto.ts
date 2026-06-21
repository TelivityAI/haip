import { IsDateString, IsInt, IsOptional, IsString, IsUUID, Min, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Public availability search. `propertyId` is intentionally absent — it is pinned
 * by the controller from the booking-key principal, never accepted from the client.
 */
export class BeSearchDto {
  @ApiProperty({ example: '2026-07-01' })
  @IsDateString()
  checkIn!: string;

  @ApiProperty({ example: '2026-07-04' })
  @IsDateString()
  checkOut!: string;

  @ApiPropertyOptional({ description: 'Limit to a single room type' })
  @IsOptional()
  @IsUUID()
  roomTypeId?: string;

  @ApiPropertyOptional({ default: 2 })
  @IsOptional()
  @IsInt()
  @Min(1)
  adults?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  children?: number;

  @ApiPropertyOptional({ description: 'Optional promo/rate code' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  promoCode?: string;
}
