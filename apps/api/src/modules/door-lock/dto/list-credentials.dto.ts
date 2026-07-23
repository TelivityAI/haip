import { IsEnum, IsOptional, IsUUID, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ListDoorLockCredentialsDto {
  @ApiProperty({ description: 'Property UUID' })
  @IsUUID()
  propertyId!: string;

  @ApiPropertyOptional({ enum: ['active', 'revoked'] })
  @IsOptional()
  @IsEnum(['active', 'revoked'])
  status?: 'active' | 'revoked';

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}
