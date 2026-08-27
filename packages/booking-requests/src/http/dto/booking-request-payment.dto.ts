import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { IsMoneyString } from '@telivityhaip/shared';

export const BOOKING_REQUEST_INSTALLMENT_MILESTONES = [
  'date',
  'arrival',
  'checkout',
  'manual',
] as const;

export const BOOKING_REQUEST_EXTERNAL_PAYMENT_METHODS = [
  'credit_card',
  'debit_card',
  'cash',
  'bank_transfer',
  'pix',
  'other',
] as const;

export class CreateBookingRequestInstallmentDto {
  @ApiProperty({ example: '30% deposit' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  label!: string;

  @ApiPropertyOptional({ minimum: 0, default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiPropertyOptional({ example: '100.00' })
  @IsOptional()
  @IsMoneyString()
  fixedAmount?: string;

  @ApiPropertyOptional({ example: '30.00', description: 'Percentage from 0.01 to 100.00' })
  @IsOptional()
  @IsMoneyString({ maximum: '100' })
  percentage?: string;

  @ApiProperty({ enum: BOOKING_REQUEST_INSTALLMENT_MILESTONES })
  @IsEnum(BOOKING_REQUEST_INSTALLMENT_MILESTONES)
  dueMilestone!: (typeof BOOKING_REQUEST_INSTALLMENT_MILESTONES)[number];

  @ApiPropertyOptional({ example: '2026-09-01' })
  @IsOptional()
  @IsDateString({ strict: true })
  dueDate?: string;
}

export class UpdateBookingRequestInstallmentDto extends PartialType(
  CreateBookingRequestInstallmentDto,
) {}

export class ReorderBookingRequestInstallmentsDto {
  @ApiProperty({ type: [String], description: 'Every request installment ID in target order' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  installmentIds!: string[];
}

export class AllocateBookingRequestPaymentDto {
  @ApiProperty()
  @IsUUID()
  paymentId!: string;

  @ApiProperty({ example: '50.00' })
  @IsMoneyString()
  amount!: string;
}

export class ChargeBookingRequestCardDto {
  @ApiProperty({ example: '50.00' })
  @IsMoneyString()
  amount!: string;

  @ApiProperty({ description: 'Stable client-generated identity for this charge' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  idempotencyKey!: string;
}

export class RecordBookingRequestExternalPaymentDto {
  @ApiProperty({ example: '50.00' })
  @IsMoneyString()
  amount!: string;

  @ApiProperty({ example: 'EUR' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(3)
  currencyCode!: string;

  @ApiProperty({ enum: BOOKING_REQUEST_EXTERNAL_PAYMENT_METHODS })
  @IsEnum(BOOKING_REQUEST_EXTERNAL_PAYMENT_METHODS)
  method!: (typeof BOOKING_REQUEST_EXTERNAL_PAYMENT_METHODS)[number];

  @ApiProperty({ description: 'When the externally collected money moved' })
  @IsDateString()
  processedAt!: string;

  @ApiPropertyOptional({ example: 'bank' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  provider?: string;

  @ApiProperty({ description: 'Provider, terminal, bank, or receipt reference' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  reference!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class RefundBookingRequestPaymentDto {
  @ApiProperty({ example: '25.00' })
  @IsMoneyString()
  amount!: string;

  @ApiProperty({ description: 'Stable client-generated identity for this refund' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  idempotencyKey!: string;
}

export class RecordBookingRequestExternalReturnDto {
  @ApiProperty({ example: '25.00' })
  @IsMoneyString()
  amount!: string;

  @ApiProperty({ description: 'When the external money was returned' })
  @IsDateString()
  processedAt!: string;

  @ApiProperty({ description: 'Bank, terminal, or receipt return reference' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  reference!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class RetainBookingRequestPaymentDto {
  @ApiProperty({ example: '25.00' })
  @IsMoneyString()
  amount!: string;

  @ApiProperty({ description: 'Mandatory business reason for retaining captured money' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  reason!: string;
}
