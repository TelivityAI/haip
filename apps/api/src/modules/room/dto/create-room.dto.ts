import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsBoolean,
  IsUUID,
  IsArray,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateRoomDto {
  @ApiProperty()
  @IsUUID()
  propertyId!: string;

  @ApiProperty()
  @IsUUID()
  roomTypeId!: string;

  @ApiProperty({ example: '101' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  number!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(10)
  floor?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(50)
  building?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isAccessible?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isConnecting?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  connectingRoomId?: string;

  @ApiPropertyOptional({ example: ['wifi', 'minibar'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  amenities?: string[];

  @ApiPropertyOptional({
    description: 'Vendor lock/device id for contactless room access',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  externalLockId?: string;
}
