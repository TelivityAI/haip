import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Partial lifecycle-email override. Every field is optional: the omitted ones keep
 * the built-in copy, so a hotel can change only the subject without restating a body.
 */
export class UpdateEmailTemplateDto {
  @ApiPropertyOptional({ description: 'Whether this lifecycle email is sent at all' })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({ example: 'Your stay at {property_name} is confirmed' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  subject?: string;

  @ApiPropertyOptional({ description: 'Body used for a first-time guest' })
  @IsOptional()
  @IsString()
  @MaxLength(8000)
  bodyFirstTime?: string;

  @ApiPropertyOptional({ description: 'Body used for a returning guest' })
  @IsOptional()
  @IsString()
  @MaxLength(8000)
  bodyRepeat?: string;
}
