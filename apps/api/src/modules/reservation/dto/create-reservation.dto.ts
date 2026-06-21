import {
  IsUUID,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  IsEnum,
  Min,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsMoneyString } from '../../../common/validation/is-money-string.validator';

export class CreateReservationDto {
  @ApiProperty()
  @IsUUID()
  propertyId!: string;

  @ApiProperty()
  @IsUUID()
  guestId!: string;

  @ApiProperty({ example: '2024-06-01' })
  @IsDateString()
  arrivalDate!: string;

  @ApiProperty({ example: '2024-06-05' })
  @IsDateString()
  departureDate!: string;

  @ApiProperty()
  @IsUUID()
  roomTypeId!: string;

  @ApiProperty()
  @IsUUID()
  ratePlanId!: string;

  @ApiProperty({ example: '799.96' })
  @IsMoneyString({ allowZero: true }) // non-negative; 0 allowed for comp rooms
  totalAmount!: string;

  @ApiProperty({ example: 'USD' })
  @IsString()
  @MaxLength(3)
  currencyCode!: string;

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

  @ApiProperty({ enum: ['direct', 'ota', 'gds', 'phone', 'walk_in', 'agent', 'group', 'corporate'] })
  @IsEnum(['direct', 'ota', 'gds', 'phone', 'walk_in', 'agent', 'group', 'corporate'])
  source!: string;

  @ApiPropertyOptional({ example: 'booking_com' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  channelCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  externalConfirmation?: string;
}
