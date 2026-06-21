import {
  IsUUID,
  IsEnum,
  IsNumber,
  IsOptional,
  IsDateString,
  IsString,
  MaxLength,
  Min,
  Max,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Body for POST /channels/rate-parity/override. Replaces the previous
 * `@Body() override: any`, which spread arbitrary attacker-controlled keys into
 * the persisted `config.rateOverrides` JSON and left `adjustmentValue` unbounded.
 * With this DTO the global ValidationPipe (whitelist + forbidNonWhitelisted)
 * strips unknown keys and bounds the values.
 */
export class SetRateOverrideDto {
  @ApiProperty({ format: 'uuid', description: 'Rate plan the override applies to' })
  @IsUUID()
  ratePlanId!: string;

  @ApiProperty({ enum: ['percentage', 'fixed'] })
  @IsEnum(['percentage', 'fixed'])
  adjustmentType!: 'percentage' | 'fixed';

  @ApiProperty({
    example: -10,
    description: 'Percentage (e.g. -10 = 10% lower) or fixed amount. Bounded to sane limits.',
  })
  @IsNumber()
  @Min(-100000)
  @Max(100000)
  adjustmentValue!: number;

  @ApiPropertyOptional({ example: '2026-07-01' })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({ example: '2026-07-31' })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional({ example: 'Summer parity correction' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
