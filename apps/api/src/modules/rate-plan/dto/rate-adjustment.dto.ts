import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNumber, IsInt, Min, Max } from 'class-validator';

export class RateAdjustmentRuleDto {
  @ApiProperty({ enum: ['percentage', 'fixed'] })
  @IsEnum(['percentage', 'fixed'])
  adjustmentType!: 'percentage' | 'fixed';

  @ApiProperty({ description: 'Negative = discount, positive = surcharge' })
  @IsNumber()
  adjustmentValue!: number;
}

export class LosAdjustmentDto extends RateAdjustmentRuleDto {
  @ApiProperty({ example: 7, description: 'Minimum stay length (nights) to trigger this tier' })
  @IsInt()
  @Min(1)
  minNights!: number;
}

export class OccupancyBandDto extends RateAdjustmentRuleDto {
  @ApiProperty({ example: 0 })
  @IsNumber()
  @Min(0)
  @Max(100)
  occupancyPctMin!: number;

  @ApiProperty({ example: 50 })
  @IsNumber()
  @Min(0)
  @Max(100)
  occupancyPctMax!: number;
}
