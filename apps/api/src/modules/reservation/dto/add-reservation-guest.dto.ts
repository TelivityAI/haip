import { IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AddReservationGuestDto {
  @ApiProperty({ description: 'Guest profile to attach as an accompanying occupant' })
  @IsUUID()
  guestId!: string;
}
