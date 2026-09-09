import {
  IsUUID,
  IsIn,
  IsOptional,
  IsInt,
  IsDateString,
  IsString,
  IsArray,
  IsBoolean,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

const TASK_TYPES = ['checkout', 'stayover', 'deep_clean', 'inspection', 'turndown', 'maintenance'] as const;

class ChecklistItemDto {
  @ApiProperty()
  @IsString()
  item!: string;

  @ApiProperty()
  @IsBoolean()
  checked!: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

export class CreateTaskDto {
  @ApiProperty()
  @IsUUID()
  propertyId!: string;

  @ApiProperty()
  @IsUUID()
  roomId!: string;

  @ApiProperty({ enum: TASK_TYPES })
  @IsIn(TASK_TYPES)
  type!: string;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  priority?: number;

  @ApiProperty()
  @IsDateString()
  serviceDate!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ type: [ChecklistItemDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChecklistItemDto)
  checklist?: Array<{ item: string; checked: boolean; notes?: string }>;
}
