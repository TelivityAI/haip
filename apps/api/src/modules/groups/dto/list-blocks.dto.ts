import { IsUUID, IsOptional, IsEnum, IsInt, Min, Max } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

const BLOCK_STATUSES = ['tentative', 'definite', 'released', 'cancelled'] as const;

export class ListBlocksDto {
  @ApiProperty({ description: 'Property ID (required for multi-tenancy)' })
  @IsUUID()
  propertyId!: string;

  @ApiPropertyOptional({ description: 'Filter by group profile' })
  @IsOptional()
  @IsUUID()
  groupProfileId?: string;

  @ApiPropertyOptional({ enum: BLOCK_STATUSES })
  @IsOptional()
  @IsEnum(BLOCK_STATUSES)
  status?: string;

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
