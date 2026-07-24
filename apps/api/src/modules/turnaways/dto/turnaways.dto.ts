import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsMoneyString } from '../../../common/validation/is-money-string.validator';

const TURNAWAY_TYPES = ['denial', 'regret'] as const;

export class CreateTurnawayReasonCodeDto {
  @ApiProperty({ example: 'FULLY_BOOKED' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  code!: string;

  @ApiProperty({ example: 'Property was sold out' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  description!: string;

  @ApiProperty({ enum: TURNAWAY_TYPES })
  @IsEnum(TURNAWAY_TYPES)
  type!: (typeof TURNAWAY_TYPES)[number];

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class ListTurnawayReasonCodesDto {
  @ApiProperty()
  @IsUUID()
  propertyId!: string;
}

export class CreateTurnawayDto {
  @ApiProperty({ example: '2026-08-10' })
  @IsDateString()
  arrivalDate!: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  nights?: number;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  roomsRequested?: number;

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
  @IsUUID()
  roomTypeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  ratePlanId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  reasonCodeId?: string;

  @ApiProperty({ enum: TURNAWAY_TYPES })
  @IsEnum(TURNAWAY_TYPES)
  type!: (typeof TURNAWAY_TYPES)[number];

  @ApiPropertyOptional({ example: 'phone' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  channel?: string;

  @ApiPropertyOptional({ example: '189.00' })
  @IsOptional()
  @IsMoneyString()
  quotedRateAmount?: string;

  @ApiPropertyOptional({ example: 'USD' })
  @IsOptional()
  @IsString()
  @MaxLength(3)
  currencyCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  comment?: string;
}

export class ListTurnawaysDto {
  @ApiProperty()
  @IsUUID()
  propertyId!: string;

  @ApiPropertyOptional({ example: '2026-08-01' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ example: '2026-08-31' })
  @IsOptional()
  @IsDateString()
  to?: string;
}
