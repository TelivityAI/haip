import { IsUUID, IsOptional, IsBoolean } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AddReservationGuestDto {
  @ApiProperty({ description: 'Guest profile to attach as an accompanying occupant' })
  @IsUUID()
  guestId!: string;

  @ApiPropertyOptional({
    description:
      'Explicit staff override to exceed the room type\'s configured maxOccupancy (e.g. extra bed/crib for a family)',
  })
  @IsOptional()
  @IsBoolean()
  overrideMaxOccupancy?: boolean;
}
