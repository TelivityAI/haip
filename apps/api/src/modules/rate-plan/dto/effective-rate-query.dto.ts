import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsInt, IsOptional, Min } from 'class-validator';

export class EffectiveRateQueryDto {
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
