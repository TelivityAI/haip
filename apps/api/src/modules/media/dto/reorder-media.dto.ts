import { IsUUID, IsEnum, IsArray, ArrayNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { MEDIA_OWNER_TYPES } from './create-media.dto';

export class ReorderMediaDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  propertyId!: string;

  @ApiProperty({ enum: MEDIA_OWNER_TYPES })
  @IsEnum(MEDIA_OWNER_TYPES)
  ownerType!: (typeof MEDIA_OWNER_TYPES)[number];

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  ownerId!: string;

  @ApiProperty({
    type: [String],
    format: 'uuid',
    description: 'Media ids in the desired display order',
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('all', { each: true })
  orderedIds!: string[];
}
