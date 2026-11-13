import { IsUUID, IsInt, IsOptional, IsDateString, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SetInventorySpanDto {
  @ApiProperty()
  @IsUUID()
  propertyId!: string;

  @ApiProperty()
  @IsUUID()
  roomTypeId!: string;

  @ApiProperty({ example: 8 })
  @IsInt()
  @Min(0)
  roomsAllotted!: number;

  @ApiPropertyOptional({ description: 'Inclusive. Defaults to the block inventory span start.' })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({ description: 'Exclusive. Defaults to the block inventory span end.' })
  @IsOptional()
  @IsDateString()
  endDate?: string;
}
