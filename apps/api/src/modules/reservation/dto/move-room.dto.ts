import { IsUUID, IsOptional, IsBoolean, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class MoveRoomDto {
  @ApiProperty({ description: 'Target room ID' })
  @IsUUID()
  roomId!: string;

  @ApiPropertyOptional({
    description: 'Allow move when reservation.doNotMove is true',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  overrideDoNotMove?: boolean;

  @ApiPropertyOptional({ description: 'Reason / note for the move' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
