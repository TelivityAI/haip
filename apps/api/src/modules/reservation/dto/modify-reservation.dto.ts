import { IsUUID, IsInt, IsOptional, IsString, IsBoolean, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsCanonicalCalendarDate } from '@telivityhaip/shared';

export class ModifyReservationDto {
  @ApiPropertyOptional({ example: '2024-06-02' })
  @IsOptional()
  @IsCanonicalCalendarDate()
  arrivalDate?: string;

  @ApiPropertyOptional({ example: '2024-06-06' })
  @IsOptional()
  @IsCanonicalCalendarDate()
  departureDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  roomTypeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  ratePlanId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  totalAmount?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  adults?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  children?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  specialRequests?: string;

  @ApiPropertyOptional({ description: 'Block room moves unless overridden' })
  @IsOptional()
  @IsBoolean()
  doNotMove?: boolean;
}
