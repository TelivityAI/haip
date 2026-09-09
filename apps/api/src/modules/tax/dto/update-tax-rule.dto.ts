import {
  IsString,
  IsNumber,
  IsBoolean,
  IsOptional,
  IsArray,
  IsDateString,
  IsObject,
  IsIn,
  IsInt,
  ValidateIf,
  Min,
  Max,
} from 'class-validator';

export class UpdateTaxRuleDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  code?: string;

  @IsIn(['percentage', 'flat_per_night', 'flat_per_stay', 'split_component'])
  @IsOptional()
  type?: 'percentage' | 'flat_per_night' | 'flat_per_stay' | 'split_component';

  @IsString()
  @IsOptional()
  rate?: string;

  // Required when type === 'split_component'. Percentage of charge amount
  // (0.01–100) to which the `rate` applies.
  @ValidateIf((o) => o.type === 'split_component')
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(100)
  splitPercentage?: number;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  appliesToChargeTypes?: string[];

  @IsObject()
  @IsOptional()
  exemptions?: {
    guestTypes?: string[];
    minStayNights?: number;
    maxNights?: number;
  };

  @IsBoolean()
  @IsOptional()
  isCompounding?: boolean;

  @IsInt()
  @IsOptional()
  sortOrder?: number;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @IsDateString()
  @IsOptional()
  effectiveFrom?: string;

  @IsDateString()
  @IsOptional()
  effectiveTo?: string;
}
