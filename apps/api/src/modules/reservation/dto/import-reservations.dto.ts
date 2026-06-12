import {
  IsArray,
  IsUUID,
  IsDateString,
  IsString,
  IsOptional,
  IsInt,
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
 * NOTE: actual CSV-file parsing / multipart upload is out of scope. The endpoint
 * accepts a pre-parsed JSON array; a thin CSV parser can map columns to these
 * fields and POST the result.
 */
export class CreateReservationRow {
  @ApiProperty()
  @IsUUID()
  guestId!: string;

  @ApiProperty({ example: '2026-06-01' })
  @IsDateString()
  arrivalDate!: string;

  @ApiProperty({ example: '2026-06-05' })
  @IsDateString()
  departureDate!: string;

  @ApiProperty()
  @IsUUID()
  roomTypeId!: string;

  @ApiProperty()
  @IsUUID()
  ratePlanId!: string;

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
}

export class ImportReservationsDto {
  @ApiProperty({ description: 'Property to import into' })
  @IsUUID()
  propertyId!: string;

  @ApiProperty({ description: 'Pre-parsed reservation rows', type: [CreateReservationRow] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateReservationRow)
  rows!: CreateReservationRow[];
}
