import { IsUUID, IsOptional, IsEnum, IsInt, Min, Max } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

const GROUP_TYPES = ['corporate', 'travel_agent', 'wholesale', 'event', 'other'] as const;

export class ListGroupProfilesDto {
  @ApiProperty({ description: 'Property ID (required for multi-tenancy)' })
  @IsUUID()
  propertyId!: string;

  @ApiPropertyOptional({ enum: GROUP_TYPES })
  @IsOptional()
  @IsEnum(GROUP_TYPES)
  type?: string;

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
