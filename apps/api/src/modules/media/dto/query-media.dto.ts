import { IsUUID, IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { MEDIA_OWNER_TYPES } from './create-media.dto';

/**
 * List media for a single owner. `propertyId` is validated here (required,
 * UUID) so the list endpoint is property-scoped per the multi-tenancy rule.
 */
export class QueryMediaDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  propertyId!: string;

  @ApiProperty({ enum: MEDIA_OWNER_TYPES })
  @IsEnum(MEDIA_OWNER_TYPES)
  ownerType!: (typeof MEDIA_OWNER_TYPES)[number];

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  ownerId!: string;
}
