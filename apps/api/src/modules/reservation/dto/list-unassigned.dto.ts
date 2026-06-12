import { IsUUID, IsOptional, IsDateString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ListUnassignedDto {
  @ApiProperty({ description: 'Property to scope the search to' })
  @IsUUID()
  propertyId!: string;

  @ApiPropertyOptional({ description: 'Arrival date lower bound (inclusive)', example: '2026-06-01' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ description: 'Arrival date upper bound (inclusive)', example: '2026-06-30' })
  @IsOptional()
  @IsDateString()
  to?: string;
}
