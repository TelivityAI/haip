import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsBoolean,
  IsArray,
  IsObject,
  MaxLength,
  ArrayMinSize,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CreateReservationRow } from '../../reservation/dto/import-reservations.dto';

export class CreateMigrationJobDto {
  @ApiProperty({ description: 'Migration project reference (groups related import steps)' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  projectId!: string;

  @ApiProperty({
    description:
      'Entity to import: guests, room-types, rate-plans, rooms, open-folio-balances, reservations',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  entity!: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;

  @ApiPropertyOptional({ description: 'Pre-parsed CSV rows (generic import entities)' })
  @IsOptional()
  @IsArray()
  rows?: Record<string, string>[];

  @ApiPropertyOptional({ description: 'Column mapping for CSV rows' })
  @IsOptional()
  @IsObject()
  mapping?: Record<string, string>;

  @ApiPropertyOptional({ description: 'Pre-parsed reservation rows (entity=reservations)' })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateReservationRow)
  reservations?: CreateReservationRow[];
}
