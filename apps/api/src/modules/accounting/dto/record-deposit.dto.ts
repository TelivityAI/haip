import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsUUID,
  IsBoolean,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RecordDepositDto {
  @ApiProperty({ description: 'Property ID' })
  @IsUUID()
  @IsNotEmpty()
  propertyId!: string;

  @ApiPropertyOptional({ description: 'Reservation ID (null until linked)' })
  @IsOptional()
  @IsUUID()
  reservationId?: string;

  @ApiPropertyOptional({ description: 'Underlying payment ID' })
  @IsOptional()
  @IsUUID()
  paymentId?: string;

  @ApiProperty({ example: '200.00', description: 'Deposit amount' })
  @IsString()
  @IsNotEmpty()
  amount!: string;

  @ApiProperty({ example: 'USD', description: 'ISO 4217 currency code' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(3)
  currencyCode!: string;

  @ApiPropertyOptional({ default: true, description: 'Whether the deposit is refundable (KB 10.4)' })
  @IsOptional()
  @IsBoolean()
  isRefundable?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}
