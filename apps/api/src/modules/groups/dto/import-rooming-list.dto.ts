import {
  IsUUID,
  IsString,
  IsOptional,
  IsArray,
  IsDateString,
  ValidateNested,
  ArrayNotEmpty,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RoomingListEntryDto {
  @ApiProperty({ example: 'Jane Doe' })
  @IsString()
  @MaxLength(255)
  guestName!: string;

  @ApiPropertyOptional({ example: '2026-06-01' })
  @IsOptional()
  @IsDateString()
  arrival?: string;

  @ApiPropertyOptional({ example: '2026-06-04' })
  @IsOptional()
  @IsDateString()
  departure?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  roomTypeId?: string;

  // A reservation requires an existing guest. If absent, the row is flagged
  // 'error' rather than aborting the batch (KB 14.6).
  @ApiPropertyOptional({ description: 'Existing guest to attach the member reservation to' })
  @IsOptional()
  @IsUUID()
  guestId?: string;

  @ApiPropertyOptional({ description: 'Rate plan for the member reservation' })
  @IsOptional()
  @IsUUID()
  ratePlanId?: string;

  @ApiPropertyOptional({ example: '599.00', description: 'Total amount for the reservation' })
  @IsOptional()
  @IsString()
  totalAmount?: string;

  @ApiPropertyOptional({ example: 'USD' })
  @IsOptional()
  @IsString()
  @MaxLength(3)
  currencyCode?: string;
}

export class ImportRoomingListDto {
  @ApiProperty({ description: 'Property ID (required for multi-tenancy)' })
  @IsUUID()
  propertyId!: string;

  @ApiProperty({ type: [RoomingListEntryDto] })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => RoomingListEntryDto)
  entries!: RoomingListEntryDto[];
}
