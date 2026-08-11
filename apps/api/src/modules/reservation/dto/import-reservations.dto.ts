import {
  IsArray,
  IsUUID,
  IsDateString,
  IsString,
  IsOptional,
  IsInt,
  IsBoolean,
  Min,
  MaxLength,
  IsEnum,
  ValidateNested,
  ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * One reservation row to import. Mirrors the fields ReservationService.create
 * needs (minus propertyId, which is supplied once at the endpoint level).
 *
 * Either HAIP UUIDs or legacy PMS ids (resolved via migration_legacy_id_map
 * when projectId is supplied) may be provided for guest, room type, and rate plan.
 */
export class CreateReservationRow {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  guestId?: string;

  @ApiPropertyOptional({ description: 'Legacy PMS guest id (resolved via migration id map)' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  legacyGuestId?: string;

  @ApiProperty({ example: '2026-06-01' })
  @IsDateString()
  arrivalDate!: string;

  @ApiProperty({ example: '2026-06-05' })
  @IsDateString()
  departureDate!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  roomTypeId?: string;

  @ApiPropertyOptional({ description: 'Legacy PMS room type id (resolved via migration id map)' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  legacyRoomTypeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  ratePlanId?: string;

  @ApiPropertyOptional({ description: 'Legacy PMS rate plan id (resolved via migration id map)' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  legacyRatePlanId?: string;

  @ApiProperty({ example: '799.96' })
  @IsString()
  totalAmount!: string;

  @ApiProperty({ example: 'USD' })
  @IsString()
  @MaxLength(3)
  currencyCode!: string;

  @ApiProperty({ enum: ['direct', 'ota', 'gds', 'phone', 'walk_in', 'agent', 'group', 'corporate'] })
  @IsEnum(['direct', 'ota', 'gds', 'phone', 'walk_in', 'agent', 'group', 'corporate'])
  source!: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  adults?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  children?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  specialRequests?: string;

  @ApiPropertyOptional({ example: 'booking_engine' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  channelCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  externalConfirmation?: string;

  @ApiPropertyOptional({
    description: 'Legacy PMS reservation id — used for idempotency dedupe (project + entity + legacy_id)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  legacyId?: string;
}

export class ImportReservationsDto {
  @ApiProperty({ description: 'Property to import into' })
  @IsUUID()
  propertyId!: string;

  @ApiPropertyOptional({ description: 'Migration project id for legacy id resolution and dedupe' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  projectId?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;

  @ApiProperty({ description: 'Pre-parsed reservation rows', type: [CreateReservationRow] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateReservationRow)
  rows!: CreateReservationRow[];
}
