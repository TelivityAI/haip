import {
  IsUUID,
  IsArray,
  ArrayMinSize,
  IsOptional,
  IsInt,
  Min,
  IsString,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsMoneyString } from '../../../common/validation/is-money-string.validator';

/**
 * Split named guests from one reservation (room) onto a new sibling reservation
 * under the same booking — Apaleo/Mews booking-wrapper pattern.
 */
export class SplitReservationDto {
  @ApiProperty({ type: [String], description: 'Guest IDs to move onto the new room reservation' })
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  guestIds!: string[];

  @ApiProperty()
  @IsUUID()
  roomTypeId!: string;

  @ApiProperty()
  @IsUUID()
  ratePlanId!: string;

  @ApiProperty({ example: '199.00' })
  @IsMoneyString({ allowZero: true })
  totalAmount!: string;

  @ApiPropertyOptional({
    description: 'Defaults to source reservation currency',
  })
  @IsOptional()
  @IsString()
  @MaxLength(3)
  currencyCode?: string;

  @ApiPropertyOptional({ description: 'Optionally assign a concrete room on the new reservation' })
  @IsOptional()
  @IsUUID()
  roomId?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  adults?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  children?: number;
}
