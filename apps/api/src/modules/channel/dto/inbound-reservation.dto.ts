import { IsUUID, IsString, IsOptional, IsNumber, IsDateString, IsIn, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class ChannelReservationDto {
  @IsString()
  externalConfirmation!: string;

  @IsString()
  channelCode!: string;

  @IsString()
  guestFirstName!: string;

  @IsString()
  guestLastName!: string;

  @IsOptional()
  @IsString()
  guestEmail?: string;

  @IsOptional()
  @IsString()
  guestPhone?: string;

  @IsString()
  channelRoomCode!: string;

  @IsString()
  channelRateCode!: string;

  @IsDateString()
  arrivalDate!: string;

  @IsDateString()
  departureDate!: string;

  @IsNumber()
  adults!: number;

  @IsOptional()
  @IsNumber()
  children?: number;

  @IsNumber()
  totalAmount!: number;

  @IsString()
  currencyCode!: string;

  @IsOptional()
  @IsString()
  specialRequests?: string;

  @IsIn(['new', 'modified', 'cancelled'])
  status!: 'new' | 'modified' | 'cancelled';
}

export class InboundReservationDto {
  @IsUUID()
  channelConnectionId!: string;

  @ValidateNested()
  @Type(() => ChannelReservationDto)
  reservation!: ChannelReservationDto;
}
