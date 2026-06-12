import { IsOptional, IsUUID, IsEnum, IsBoolean, IsInt, Min, Max } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class ListAccountingCodesDto {
  @ApiProperty({ description: 'Property ID (required for multi-tenancy)' })
  @IsUUID()
  propertyId!: string;

  @ApiPropertyOptional({ enum: ['transaction', 'gl'] })
  @IsOptional()
  @IsEnum(['transaction', 'gl'])
  kind?: string;

  @ApiPropertyOptional({ description: 'Include archived codes', default: false })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  includeArchived?: boolean;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}
