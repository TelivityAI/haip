import {
  IsUUID,
  IsString,
  IsOptional,
  IsIn,
  IsBoolean,
  IsInt,
  IsDateString,
  IsArray,
  ValidateNested,
  Min,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const BLOCK_STATUSES = ['tentative', 'definite', 'released', 'cancelled'] as const;

export class BlockAllocationDto {
  @ApiProperty()
  @IsUUID()
  roomTypeId!: string;

  @ApiProperty({ example: 10 })
  @IsInt()
  @Min(0)
  roomsAllotted!: number;

  /** Inclusive. Defaults to the block inventory span start. */
  @ApiPropertyOptional({ example: '2026-06-01' })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  /** Exclusive. Defaults to the block inventory span end. */
  @ApiPropertyOptional({ example: '2026-06-05' })
  @IsOptional()
  @IsDateString()
  endDate?: string;
}

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
  @IsIn(BLOCK_STATUSES)
  status?: string;

  @ApiPropertyOptional({
    type: [BlockAllocationDto],
    description: 'Optional per-room-type holds written in the same transaction as the block',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BlockAllocationDto)
  allocations?: BlockAllocationDto[];
}
