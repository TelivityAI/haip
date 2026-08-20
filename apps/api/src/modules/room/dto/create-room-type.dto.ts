import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsInt,
  Min,
  IsBoolean,
  IsUUID,
  IsArray,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateRoomTypeDto {
  @ApiPropertyOptional({
    description:
      'Property id. Required in the body, or pass ?propertyId= as a query alias when omitted from the body.',
  })
  @IsOptional()
  @IsUUID()
  propertyId?: string;

  @ApiProperty({ example: 'Standard King' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @ApiProperty({ example: 'STD-K' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  code!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ example: 2 })
  @IsInt()
  @Min(1)
  maxOccupancy!: number;

  @ApiProperty({ example: 2 })
  @IsInt()
  @Min(1)
  defaultOccupancy!: number;

  @ApiPropertyOptional({ example: 'king' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  bedType?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  bedCount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  squareMeters?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(10)
  floor?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isAccessible?: boolean;

  @ApiPropertyOptional({ example: ['wifi', 'minibar'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  amenities?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  sortOrder?: number;
}
