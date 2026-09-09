import { IsOptional, IsUUID, IsIn, IsInt, Min, Max } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class ListFoliosDto {
  @ApiProperty({ description: 'Property ID (required for multi-tenancy)' })
  @IsUUID()
  propertyId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  reservationId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  guestId?: string;

  @ApiPropertyOptional({ enum: ['guest', 'master', 'city_ledger'] })
  @IsOptional()
  @IsIn(['guest', 'master', 'city_ledger'])
  type?: string;

  @ApiPropertyOptional({ enum: ['open', 'settled', 'closed'] })
  @IsOptional()
  @IsIn(['open', 'settled', 'closed'])
  status?: string;

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
