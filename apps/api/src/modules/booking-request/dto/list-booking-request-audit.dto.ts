import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

export class ListBookingRequestAuditDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  propertyId!: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 50;

  @ApiPropertyOptional({ description: 'Opaque keyset cursor from the previous page' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  cursor?: string;
}
