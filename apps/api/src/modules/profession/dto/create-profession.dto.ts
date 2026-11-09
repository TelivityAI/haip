import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Creates (or resolves) an entry in the global professions catalog.
 * This catalog is intentionally not property-scoped — occupations are shared.
 */
export class CreateProfessionDto {
  @ApiProperty({ description: 'Name/title of the profession or occupation', example: 'Software Engineer' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @ApiPropertyOptional({ description: 'Official code (e.g. CBO code)', example: '212405' })
  @IsString()
  @IsOptional()
  @MaxLength(50)
  code?: string;

  @ApiPropertyOptional({ description: 'ISO 3166-1 alpha-2 country code', example: 'BR' })
  @IsString()
  @IsOptional()
  @MaxLength(2)
  countryCode?: string;

  @ApiPropertyOptional({
    description: 'Structured metadata (e.g. FNRH integration metadata, synonyms, family)',
    example: { cbo: '212405' },
  })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
