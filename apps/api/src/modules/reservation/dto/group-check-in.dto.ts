import {
  IsArray,
  IsUUID,
  IsOptional,
  IsBoolean,
  ValidateNested,
  ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class GroupCheckInItem {
  @ApiProperty({ description: 'Reservation ID' })
  @IsUUID()
  reservationId!: string;

  @ApiPropertyOptional({ description: 'Override room assignment' })
  @IsOptional()
  @IsUUID()
  roomId?: string;

  @ApiPropertyOptional({ description: 'Skip deposit authorization' })
  @IsOptional()
  @IsBoolean()
  skipDepositAuth?: boolean;

  // Party check-in signs one registration card at the desk; without passing it
  // through, properties with guestRegistrationRequired reject every party
  // member while the primary succeeds (Day Zero R3 partial check-in).
  @ApiPropertyOptional({ description: 'Registration card signed (party covers all rooms)' })
  @IsOptional()
  @IsBoolean()
  registrationSigned?: boolean;

  @ApiPropertyOptional({ description: 'Registration form payload' })
  @IsOptional()
  registrationData?: Record<string, unknown>;
}

export class GroupCheckInDto {
  @ApiProperty({ description: 'List of reservations to check in', type: [GroupCheckInItem] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => GroupCheckInItem)
  reservations!: GroupCheckInItem[];
}
