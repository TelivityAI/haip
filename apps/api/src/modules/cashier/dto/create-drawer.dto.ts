import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsUUID,
  IsBoolean,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateDrawerDto {
  @ApiProperty({ description: 'Property ID' })
  @IsUUID()
  @IsNotEmpty()
  propertyId!: string;

  @ApiProperty({ example: 'Front Desk Drawer 1', description: 'Drawer name (KB 12.1)' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;

  @ApiPropertyOptional({ example: '200.00', description: 'Starting float (KB 12.1)' })
  @IsOptional()
  @IsString()
  startingFloat?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
