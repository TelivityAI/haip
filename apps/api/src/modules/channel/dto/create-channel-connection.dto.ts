import { IsUUID, IsString, IsOptional, IsArray, ValidateNested, IsIn } from 'class-validator';
import { Type } from 'class-transformer';

export class RatePlanMappingDto {
  @IsUUID()
  ratePlanId!: string;

  @IsString()
  channelRateCode!: string;
}

export class RoomTypeMappingDto {
  @IsUUID()
  roomTypeId!: string;

  @IsString()
  channelRoomCode!: string;
}

export class CreateChannelConnectionDto {
  @IsUUID()
  propertyId!: string;

  @IsString()
  channelCode!: string;

  @IsString()
  channelName!: string;

  @IsString()
  adapterType!: string;

  @IsOptional()
  @IsIn(['push', 'pull', 'bidirectional'])
  syncDirection?: string;

  @IsOptional()
  config?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RatePlanMappingDto)
  ratePlanMapping?: RatePlanMappingDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RoomTypeMappingDto)
  roomTypeMapping?: RoomTypeMappingDto[];
}
