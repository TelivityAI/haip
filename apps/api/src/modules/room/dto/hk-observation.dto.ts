import { IsEnum, IsInt, IsOptional, IsUUID, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

const OCCUPANCY = ['unknown', 'vacant', 'occupied'] as const;

export class HkObservationDto {
  @ApiProperty({ enum: OCCUPANCY })
  @IsEnum(OCCUPANCY)
  occupancy!: (typeof OCCUPANCY)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  persons?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  observedBy?: string;
}
