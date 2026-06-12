import { IsUUID, IsDateString, IsInt, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SetInventoryDto {
  @ApiProperty({ description: 'Property ID (required for multi-tenancy)' })
  @IsUUID()
  propertyId!: string;

  @ApiProperty({ example: '2026-06-02', description: 'Stay date this allotment applies to' })
  @IsDateString()
  stayDate!: string;

  @ApiProperty()
  @IsUUID()
  roomTypeId!: string;

  @ApiProperty({ example: 10, description: 'Rooms held for this date/room-type' })
  @IsInt()
  @Min(0)
  roomsAllotted!: number;
}
