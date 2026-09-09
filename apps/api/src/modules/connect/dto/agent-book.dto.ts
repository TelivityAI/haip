import {
  IsString,
  IsUUID,
  IsDateString,
  IsNumber,
  IsOptional,
  IsEmail,
  IsIn,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AgentBookDto {
  @ApiProperty()
  @IsUUID()
  propertyId!: string;

  @ApiProperty()
  @IsUUID()
  roomTypeId!: string;

  @ApiProperty()
  @IsUUID()
  ratePlanId!: string;

  @ApiProperty({ example: '2024-06-01' })
  @IsDateString()
  checkIn!: string;

  @ApiProperty({ example: '2024-06-05' })
  @IsDateString()
  checkOut!: string;

  // Guest
  @ApiProperty({ example: 'John' })
  @IsString()
  guestFirstName!: string;

  @ApiProperty({ example: 'Smith' })
  @IsString()
  guestLastName!: string;

  @ApiPropertyOptional({ example: 'john@example.com' })
  @IsOptional()
  @IsEmail()
  guestEmail?: string;

  @ApiPropertyOptional({ example: '+1-555-0100' })
  @IsOptional()
  @IsString()
  guestPhone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  loyaltyNumber?: string;

  // Occupancy
  @ApiProperty({ example: 2 })
  @IsNumber()
  @Min(1)
  adults!: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  children?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  specialRequests?: string;

  // Payment
  @ApiPropertyOptional({ enum: ['pay_at_property', 'prepaid', 'virtual_card'] })
  @IsOptional()
  @IsIn(['pay_at_property', 'prepaid', 'virtual_card'])
  paymentMethod?: 'pay_at_property' | 'prepaid' | 'virtual_card';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  paymentToken?: string;

  // Agent metadata
  @ApiPropertyOptional({ description: 'OTAIP agent that made this booking' })
  @IsOptional()
  @IsString()
  agentId?: string;

  @ApiPropertyOptional({ description: 'OTAIP booking reference' })
  @IsOptional()
  @IsString()
  externalReference?: string;
}
