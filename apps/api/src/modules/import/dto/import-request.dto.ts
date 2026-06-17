import { IsArray, IsBoolean, IsObject, IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Import payload. Provide EITHER `csv` (raw text — the dashboard reads the file
 * client-side and posts its contents) OR pre-parsed `rows`. `mapping` maps source
 * CSV column names to the importer's canonical field names. `dryRun` validates
 * without writing.
 */
export class ImportRequestDto {
  @ApiPropertyOptional({ description: 'Raw CSV text (header row + data rows)' })
  @IsOptional()
  @IsString()
  csv?: string;

  @ApiPropertyOptional({ type: [Object], description: 'Pre-parsed rows (alternative to csv)' })
  @IsOptional()
  @IsArray()
  rows?: Record<string, string>[];

  @ApiPropertyOptional({ description: 'Source column → canonical field mapping' })
  @IsOptional()
  @IsObject()
  mapping?: Record<string, string>;

  @ApiPropertyOptional({ default: false, description: 'Validate only — do not write' })
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;
}
