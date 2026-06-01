import {
  IsUUID,
  IsString,
  IsOptional,
  IsEnum,
  IsBoolean,
  IsEmail,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const GROUP_TYPES = ['corporate', 'travel_agent', 'wholesale', 'event', 'other'] as const;

export class CreateGroupProfileDto {
  @ApiProperty({ description: 'Property ID (required for multi-tenancy)' })
  @IsUUID()
  propertyId!: string;

  @ApiProperty({ example: 'Acme Annual Conference' })
  @IsString()
  @MaxLength(255)
  name!: string;

  @ApiProperty({ enum: GROUP_TYPES, default: 'corporate' })
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
  notes?: string;

  // --- Optional master/group folio creation (KB 14.7) ---
  // A group profile may own a master folio for consolidated billing. Because a
  // folio requires a guest, a guestId + currency must be supplied to create one.
  @ApiPropertyOptional({ description: 'Create a master folio for this group (KB 14.7)' })
  @IsOptional()
  @IsBoolean()
  createMasterFolio?: boolean;

  @ApiPropertyOptional({ description: 'Guest (billing contact) for the master folio' })
  @IsOptional()
  @IsUUID()
  masterFolioGuestId?: string;

  @ApiPropertyOptional({ example: 'USD' })
  @IsOptional()
  @IsString()
  @MaxLength(3)
  masterFolioCurrencyCode?: string;
}
