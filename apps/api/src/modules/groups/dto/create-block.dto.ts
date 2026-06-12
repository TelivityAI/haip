import {
  IsUUID,
  IsString,
  IsOptional,
  IsEnum,
  IsBoolean,
  IsInt,
  IsDateString,
  Min,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const BLOCK_STATUSES = ['tentative', 'definite', 'released', 'cancelled'] as const;

export class CreateBlockDto {
  @ApiProperty({ description: 'Property ID (required for multi-tenancy)' })
  @IsUUID()
  propertyId!: string;

  @ApiProperty({ description: 'Group profile this block belongs to' })
  @IsUUID()
  groupProfileId!: string;

  @ApiProperty({ example: 'Conference Room Block' })
  @IsString()
  @MaxLength(255)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  ratePlanId?: string;

  @ApiProperty({ example: '2026-06-01' })
  @IsDateString()
  startDate!: string;

  @ApiProperty({ example: '2026-06-05' })
  @IsDateString()
  endDate!: string;

  @ApiPropertyOptional({ example: '2026-05-15', description: 'Auto-release cutoff (KB 14.4)' })
  @IsOptional()
  @IsDateString()
  cutoffDate?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  autoRelease?: boolean;

  @ApiPropertyOptional({ example: '2026-05-31' })
  @IsOptional()
  @IsDateString()
  shoulderStart?: string;

  @ApiPropertyOptional({ example: '2026-06-06' })
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

  @ApiPropertyOptional({ description: 'Shareable group code for self-booking' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  groupCode?: string;

  @ApiPropertyOptional({ enum: BLOCK_STATUSES, default: 'tentative' })
  @IsOptional()
  @IsEnum(BLOCK_STATUSES)
  status?: string;
}
