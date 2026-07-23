import { IsUUID, IsOptional, IsEnum, IsDateString, IsInt, Min, Max, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

const RESERVATION_STATUSES = [
  'pending',
  'confirmed',
  'assigned',
  'checked_in',
  'stayover',
  'due_out',
  'checked_out',
  'no_show',
  'cancelled',
] as const;

export class ListReservationsDto {
  @ApiProperty({ description: 'Property ID (required for tenant scoping)' })
  @IsUUID()
  propertyId!: string;

  @ApiPropertyOptional({ enum: RESERVATION_STATUSES })
  @IsOptional()
  @IsEnum(RESERVATION_STATUSES)
  status?: string;

  @ApiPropertyOptional({
    description: 'Comma-separated statuses (takes precedence over status)',
    example: 'confirmed,assigned',
  })
  @IsOptional()
  @IsString()
  statuses?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  arrivalDateFrom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  arrivalDateTo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  departureDateFrom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  departureDateTo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  guestId?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}
