import { PartialType, OmitType } from '@nestjs/swagger';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsUUID } from 'class-validator';
import { CreateRoomDto } from './create-room.dto';

export class UpdateRoomDto extends PartialType(
  OmitType(CreateRoomDto, ['propertyId', 'roomTypeId'] as const),
) {
  /**
   * Moving a room to another room type is a legitimate admin operation
   * (re-categorising inventory; splitting a shared type into per-room types).
   * Re-added deliberately after being omitted: the service verifies the target
   * type belongs to the same property before writing, so this cannot re-point
   * a room at another tenant's type.
   */
  @ApiPropertyOptional({ description: 'Move the room to another room type (same property)' })
  @IsOptional()
  @IsUUID()
  roomTypeId?: string;

  /**
   * Retire (false) or restore (true) the room. CreateRoomDto has no isActive,
   * so a partial update could not change it. Retiring a room drops it from
   * sellable inventory and from properties.total_rooms.
   */
  @ApiPropertyOptional({ description: 'Set false to retire the room from sellable inventory' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
