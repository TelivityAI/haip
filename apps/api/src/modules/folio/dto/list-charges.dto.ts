import { IsOptional, IsUUID, IsIn, IsDateString, IsInt, Min, Max } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class ListChargesDto {
  @ApiProperty({ description: 'Property ID' })
  @IsUUID()
  propertyId!: string;

  @ApiPropertyOptional({
    enum: ['room', 'tax', 'food_beverage', 'minibar', 'phone', 'laundry', 'parking', 'spa', 'incidental', 'fee', 'adjustment', 'package'],
  })
  @IsOptional()
  @IsIn(['room', 'tax', 'food_beverage', 'minibar', 'phone', 'laundry', 'parking', 'spa', 'incidental', 'fee', 'adjustment', 'package'])
  type?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  serviceDateFrom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  serviceDateTo?: string;

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
