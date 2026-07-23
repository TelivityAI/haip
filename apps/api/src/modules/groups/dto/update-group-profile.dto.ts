import {
  IsString,
  IsOptional,
  IsEnum,
  IsEmail,
  MaxLength,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

const GROUP_TYPES = ['corporate', 'travel_agent', 'wholesale', 'event', 'other'] as const;

export class UpdateGroupProfileDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @ApiPropertyOptional({ enum: GROUP_TYPES })
  @IsOptional()
  @IsEnum(GROUP_TYPES)
  type?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  contactName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  contactEmail?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(30)
  contactPhone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  billingAddress?: string;

  @ApiPropertyOptional({ example: 'NET30' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  paymentTermsDays?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}
