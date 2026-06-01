import { IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LinkReservationDto {
  @ApiProperty({ description: 'Property ID (required for multi-tenancy)' })
  @IsUUID()
  propertyId!: string;

  @ApiProperty({ description: 'Reservation to link to this group profile' })
  @IsUUID()
  reservationId!: string;
}
