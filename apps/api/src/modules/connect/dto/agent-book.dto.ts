import {
  IsString,
  IsUUID,
  IsDateString,
  IsNumber,
  IsOptional,
  IsEmail,
  IsIn,
  Min,
  ValidateIf,
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
  @ValidateIf((o: AgentBookDto) => o.paymentMethod === 'hosted_checkout')
  @IsEmail()
  @IsOptional()
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

  // Payment — LLM schemas expose hosted_checkout | pay_at_property only.
  // prepaid/virtual_card kept for backward compatibility but do not charge.
  @ApiPropertyOptional({
    enum: ['pay_at_property', 'hosted_checkout', 'prepaid', 'virtual_card'],
  })
  @IsOptional()
  @IsIn(['pay_at_property', 'hosted_checkout', 'prepaid', 'virtual_card'])
  paymentMethod?: 'pay_at_property' | 'hosted_checkout' | 'prepaid' | 'virtual_card';

  @ApiPropertyOptional({
    description: 'Deprecated for LLM clients — cards never pass through Connect tools',
  })
  @IsOptional()
  @IsString()
  paymentToken?: string;

  /** Required for hosted_checkout — LLM-stable key per guest intent. */
  @ApiPropertyOptional({ description: 'Idempotency key (required for hosted_checkout)' })
  @ValidateIf((o: AgentBookDto) => o.paymentMethod === 'hosted_checkout')
  @IsString()
  @IsOptional()
  idempotencyKey?: string;

  /** Free-text client/platform tag for attribution (no fixed product enum). */
  @ApiPropertyOptional({
    description: 'Client platform identifier (free-text; e.g. assistant or integrator name)',
  })
  @IsOptional()
  @IsString()
  clientPlatform?: string;

  // Agent metadata
  @ApiPropertyOptional({
    description: 'Agent / channel id written to booking.channelCode when provided',
  })
  @IsOptional()
  @IsString()
  agentId?: string;

  @ApiPropertyOptional({ description: 'External booking reference / platform tag' })
  @IsOptional()
  @IsString()
  externalReference?: string;
}
