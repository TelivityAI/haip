import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

/** Search the global professions catalog (not property-scoped). */
export class SearchProfessionsDto {
  @ApiPropertyOptional({ description: 'Text search query for profession name or code' })
  @IsString()
  @IsOptional()
  q?: string;

  @ApiPropertyOptional({ description: 'Filter by country code (ISO 3166-1 alpha-2)' })
  @IsString()
  @IsOptional()
  countryCode?: string;

  @ApiPropertyOptional({ description: 'Max items to return', default: 25, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 25;
}
