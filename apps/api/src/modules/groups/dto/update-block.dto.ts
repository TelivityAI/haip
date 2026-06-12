import {
  IsString,
  IsOptional,
  IsEnum,
  IsBoolean,
  IsInt,
  IsDateString,
  IsUUID,
  Min,
  MaxLength,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

const BLOCK_STATUSES = ['tentative', 'definite', 'released', 'cancelled'] as const;

export class UpdateBlockDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  ratePlanId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  cutoffDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  autoRelease?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  shoulderStart?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  shoulderEnd?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  minLos?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  maxLos?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(50)
  groupCode?: string;

  @ApiPropertyOptional({ enum: BLOCK_STATUSES })
  @IsOptional()
  @IsEnum(BLOCK_STATUSES)
  status?: string;
}
