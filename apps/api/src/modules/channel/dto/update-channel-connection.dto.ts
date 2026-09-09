import { IsString, IsOptional, IsArray, ValidateNested, IsIn } from 'class-validator';
import { Type } from 'class-transformer';
import { RatePlanMappingDto, RoomTypeMappingDto } from './create-channel-connection.dto';

export class UpdateChannelConnectionDto {
  @IsOptional()
  @IsString()
  channelName?: string;

  @IsOptional()
  @IsIn(['active', 'inactive', 'pending_setup'])
  status?: string;

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
