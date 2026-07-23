import { IsUUID, IsDateString, IsInt, IsOptional, IsString, IsBoolean, Min, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ModifyReservationDto {
  @ApiPropertyOptional({ example: '2024-06-02' })
  @IsOptional()
  @IsDateString()
  arrivalDate?: string;

  @ApiPropertyOptional({ example: '2024-06-06' })
  @IsOptional()
  @IsDateString()
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
