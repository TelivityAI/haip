import { PartialType, OmitType, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';
import { CreateRoomTypeDto } from './create-room-type.dto';

/**
 * A room type could be created and then never changed: the controller exposed
 * GET types, POST types and GET types/:id, and nothing else. No PATCH, no PUT,
 * no DELETE, and no update DTO existed anywhere in the codebase.
 *
 * That makes every field a one-shot decision. Capacity is the one that bites:
 * a type created with the wrong maxOccupancy will let reservations be booked
 * beyond what the room physically sleeps, and there was no way to correct it
 * short of writing to the database by hand.
 *
 * propertyId is omitted, matching UpdateRoomDto — an update must not be able to
 * move a row between tenants.
 */
export class UpdateRoomTypeDto extends PartialType(
  OmitType(CreateRoomTypeDto, ['propertyId'] as const),
) {
  /**
   * Retire a room type without deleting it.
   *
   * There is no DELETE for room types and there should not be: reservations
   * reference roomTypeId permanently, so deleting one would either break
   * history or cascade into it. isActive already exists on the row and
   * findAllRoomTypes already filters on it — it simply had no way to be set.
   * Same shape as the rate-plan deactivation fix in #320.
   */
  @ApiPropertyOptional({ description: 'Retire the room type without deleting it' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
