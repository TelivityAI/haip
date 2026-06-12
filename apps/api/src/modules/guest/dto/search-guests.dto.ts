import { IsOptional, IsString, IsEnum, IsBoolean, IsInt, Min, Max } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';

export class SearchGuestsDto {
  // The controller reads propertyId via @Query('propertyId', ParseUUIDPipe); it must ALSO be
  // declared here or the global ValidationPipe (forbidNonWhitelisted) rejects the whole request.
  @ApiPropertyOptional({ description: 'Tenant property id (validated by the controller)' })
  @IsOptional()
  @IsString()
  propertyId?: string;

  @ApiPropertyOptional({ description: 'Search by name, email, or phone' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  loyaltyNumber?: string;

  @ApiPropertyOptional({ enum: ['none', 'silver', 'gold', 'platinum', 'diamond'] })
  @IsOptional()
  @IsEnum(['none', 'silver', 'gold', 'platinum', 'diamond'])
  vipLevel?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => value === 'true')
  @IsBoolean()
  isDnr?: boolean;

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
