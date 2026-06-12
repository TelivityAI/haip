import {
  IsUUID,
  IsString,
  IsOptional,
  IsEnum,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MEDIA_OWNER_TYPES, MEDIA_CATEGORIES } from './create-media.dto';

/**
 * Multipart form fields accompanying an uploaded file (the binary arrives via
 * the `file` part, handled by FileInterceptor — not declared here).
 */
export class UploadMediaDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  propertyId!: string;

  @ApiProperty({ enum: MEDIA_OWNER_TYPES })
  @IsEnum(MEDIA_OWNER_TYPES)
  ownerType!: (typeof MEDIA_OWNER_TYPES)[number];

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  ownerId!: string;

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
}
