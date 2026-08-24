import {
  IsArray,
  IsBoolean,
  IsHexColor,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
  ArrayMaxSize,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { BookingFormQuestion, BookingFormQuestionType } from '@telivityhaip/database';

const BOOKING_FORM_QUESTION_TYPES: BookingFormQuestionType[] = [
  'short_text',
  'long_text',
  'single_select',
  'multi_select',
  'yes_no',
  'date',
];

export class DepositPolicyDto {
  @ApiProperty({ enum: ['none', 'first_night', 'percentage', 'full'] })
  @IsIn(['none', 'first_night', 'percentage', 'full'])
  type!: 'none' | 'first_night' | 'percentage' | 'full';

  @ApiPropertyOptional({ description: 'Required when type=percentage', minimum: 0, maximum: 100 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  percentage?: number;

  @ApiProperty()
  @IsBoolean()
  refundable!: boolean;
}

/** Admin: create a publishable booking key. */
export class CreateBookingKeyDto {
  @ApiProperty({ example: 'Website widget' })
  @IsString()
  @MaxLength(200)
  label!: string;
}

export class BookingFormQuestionDto implements BookingFormQuestion {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  id!: string;

  @ApiProperty({ maxLength: 200 })
  @IsString()
  @MaxLength(200)
  label!: string;

  @ApiProperty({ enum: BOOKING_FORM_QUESTION_TYPES })
  @IsIn(BOOKING_FORM_QUESTION_TYPES)
  type!: BookingFormQuestionType;

  @ApiPropertyOptional({ type: [String], maxItems: 50 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  options?: string[];

  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  order!: number;

  @ApiProperty()
  @IsBoolean()
  isActive!: boolean;

  @ApiProperty()
  @IsBoolean()
  isRequired!: boolean;
}

/** Admin: update per-property booking engine config. */
export class UpdateBookingEngineConfigDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  displayName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  logoMediaId?: string;

  @ApiPropertyOptional({ example: '#0F172A' })
  @IsOptional()
  @IsHexColor()
  primaryColor?: string;

  @ApiPropertyOptional({ example: '#2563EB' })
  @IsOptional()
  @IsHexColor()
  accentColor?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  sellableRoomTypeIds?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  sellableRatePlanIds?: string[];

  @ApiPropertyOptional({ type: DepositPolicyDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => DepositPolicyDto)
  depositPolicy?: DepositPolicyDto;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  autoConfirm?: boolean;

  @ApiPropertyOptional({ enum: ['instant', 'request'] })
  @IsOptional()
  @IsIn(['instant', 'request'])
  bookingMode?: 'instant' | 'request';

  @ApiPropertyOptional({ enum: ['required', 'optional', 'disabled'] })
  @IsOptional()
  @IsIn(['required', 'optional', 'disabled'])
  paymentMethodCollection?: 'required' | 'optional' | 'disabled';

  @ApiPropertyOptional({ type: [BookingFormQuestionDto], maxItems: 50 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => BookingFormQuestionDto)
  formQuestions?: BookingFormQuestionDto[];

  @ApiPropertyOptional({ description: 'Stripe PUBLISHABLE key (safe to expose)' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  stripePublishableKey?: string;
}
