import { IsUUID, IsOptional, IsBoolean } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Move a named guest from this reservation to another reservation on the
 * same booking (room-to-room within the party).
 */
export class MoveReservationGuestDto {
  @ApiProperty({ description: 'Target reservation (must share the same booking)' })
  @IsUUID()
  targetReservationId!: string;

  @ApiPropertyOptional({
    description: 'When true, make this guest the primary on the target reservation',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  makePrimary?: boolean;
}
