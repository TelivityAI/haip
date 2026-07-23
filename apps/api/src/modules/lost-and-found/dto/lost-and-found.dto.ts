import {
  IsUUID,
  IsOptional,
  IsString,
  IsEnum,
  IsDateString,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const STATUSES = ['held', 'returned', 'disposed'] as const;

export class CreateLostAndFoundItemDto {
  @ApiProperty()
  @IsUUID()
  propertyId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  roomId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  reservationId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  guestId?: string;

  @ApiProperty()
  @IsString()
  description!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  foundAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateLostAndFoundItemDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  roomId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  reservationId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  guestId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ enum: STATUSES })
  @IsOptional()
  @IsEnum(STATUSES)
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

export class ListLostAndFoundItemsDto {
  @ApiProperty()
  @IsUUID()
  propertyId!: string;

  @ApiPropertyOptional({ enum: STATUSES })
  @IsOptional()
  @IsEnum(STATUSES)
  status?: string;
}
