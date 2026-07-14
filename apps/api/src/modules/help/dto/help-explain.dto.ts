import { IsObject, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class HelpExplainDto {
  @ApiProperty({ example: '/night-audit' })
  @IsString()
  route!: string;

  /**
   * Screen facts for grounded explain. Free-form strings are stripped before
   * the model sees them — pass numbers (and numeric strings) only.
   */
  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    example: { occupancyRate: 0.72, adr: 189.5, openFolios: 12 },
  })
  @IsOptional()
  @IsObject()
  facts?: Record<string, unknown>;
}
