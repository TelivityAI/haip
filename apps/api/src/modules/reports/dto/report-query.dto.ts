import { IsUUID, IsDateString, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ReportQueryDto {
  @ApiProperty({ description: 'Property ID' })
  @IsUUID()
  propertyId!: string;

  @ApiPropertyOptional({
    description: 'Report date (YYYY-MM-DD). Defaults to today when omitted.',
    example: '2026-04-06',
  })
  @IsOptional()
  @IsDateString()
  date?: string;
}

export class ReportRangeQueryDto {
  @IsUUID()
  propertyId!: string;

  @IsDateString()
  startDate!: string;

  @IsDateString()
  endDate!: string;
}
