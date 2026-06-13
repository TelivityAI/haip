import {
  IsUUID,
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  IsInt,
  IsBoolean,
  IsUrl,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const MEDIA_OWNER_TYPES = ['property', 'room_type', 'room'] as const;
export const MEDIA_CATEGORIES = [
  'hero',
  'exterior',
  'room',
  'amenity',
  'dining',
  'other',
] as const;

export class CreateMediaDto {
  @ApiProperty({ format: 'uuid', description: 'Tenant property scope' })
  @IsUUID()
  propertyId!: string;

  @ApiProperty({ enum: MEDIA_OWNER_TYPES })
  @IsEnum(MEDIA_OWNER_TYPES)
  ownerType!: (typeof MEDIA_OWNER_TYPES)[number];

  @ApiProperty({ format: 'uuid', description: 'property / room_type / room id' })
  @IsUUID()
  ownerId!: string;

  @ApiProperty({ example: 'https://images.example.com/hero.jpg' })
  @IsUrl({ require_tld: false })
  @MaxLength(2048)
  url!: string;

  @ApiPropertyOptional({ enum: MEDIA_CATEGORIES, default: 'other' })
  @IsOptional()
  @IsEnum(MEDIA_CATEGORIES)
  category?: (typeof MEDIA_CATEGORIES)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  caption?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  altText?: string;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}
