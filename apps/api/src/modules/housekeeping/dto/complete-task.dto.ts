import {
  IsOptional,
  IsString,
  IsBoolean,
  IsArray,
  IsDateString,
  ValidateNested,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

class ChecklistItemDto {
  @ApiPropertyOptional()
  @IsString()
  item!: string;

  @ApiPropertyOptional()
  @IsBoolean()
  checked!: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

export class CompleteTaskDto {
  @ApiPropertyOptional({ type: [ChecklistItemDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChecklistItemDto)
  checklist?: Array<{ item: string; checked: boolean; notes?: string }>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  maintenanceRequired?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  maintenanceNotes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ description: 'Optional ISO start timestamp when backfilling or completing directly' })
  @IsOptional()
  @IsDateString()
  startedAt?: string;

  @ApiPropertyOptional({ description: 'Optional ISO finish timestamp; defaults to now()' })
  @IsOptional()
  @IsDateString()
  completedAt?: string;
}
