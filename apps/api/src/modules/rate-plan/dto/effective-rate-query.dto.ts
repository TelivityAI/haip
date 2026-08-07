import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsInt, IsOptional, IsUUID, Min } from 'class-validator';

export class EffectiveRateQueryDto {
  // The controller also binds propertyId via @Query('propertyId'), but the
  // global ValidationPipe validates the WHOLE query object against this DTO —
  // without this field every call 400s with "property propertyId should not
  // exist" (forbidNonWhitelisted). Day Zero P0.
  @ApiPropertyOptional({ description: 'Property ID (also bound by the controller)' })
  @IsOptional()
  @IsUUID()
  propertyId?: string;

  @ApiPropertyOptional({ description: 'Length of stay in nights (alternative to checkIn/checkOut)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  nights?: number;

  @ApiPropertyOptional({ description: 'Stay arrival date (ISO) — used for occupancy lookup' })
  @IsOptional()
  @IsDateString()
  checkIn?: string;

  @ApiPropertyOptional({ description: 'Stay departure date (ISO) — derives nights when nights omitted' })
  @IsOptional()
  @IsDateString()
  checkOut?: string;

  @ApiPropertyOptional({
    description: 'Specific stay night for occupancy-based pricing (defaults to checkIn)',
  })
  @IsOptional()
  @IsDateString()
  stayDate?: string;
}
