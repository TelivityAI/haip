import { IsUUID, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class PushContentDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  propertyId!: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Push to one connection; omit for all active connections' })
  @IsOptional()
  @IsUUID()
  channelConnectionId?: string;
}
