import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsMoneyString } from '../../../common/validation/is-money-string.validator';

const INBOUND_CHARGE_TYPES = [
  'food_beverage',
  'minibar',
  'phone',
  'laundry',
  'parking',
  'spa',
  'incidental',
  'fee',
  'adjustment',
  'package',
] as const;

export class PostFolioInboundChargeDto {
  @ApiProperty({ example: '1204' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  roomNumber!: string;

  @ApiProperty({ enum: INBOUND_CHARGE_TYPES, example: 'minibar' })
  @IsEnum(INBOUND_CHARGE_TYPES)
  type!: (typeof INBOUND_CHARGE_TYPES)[number];

  @ApiProperty({ example: '18.50' })
  @IsMoneyString()
  amount!: string;

  @ApiProperty({ example: 'USD' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(3)
  currencyCode!: string;

  @ApiProperty({ example: 'pbx-call-0001249' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  vendorTxnId!: string;

  @ApiPropertyOptional({ example: 'International call surcharge' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;

  @ApiPropertyOptional({ example: '2026-07-23' })
  @IsOptional()
  @IsDateString()
  serviceDate?: string;
}
