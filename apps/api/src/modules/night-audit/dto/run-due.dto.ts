import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';

export class RunDueAuditsDto {
  @IsOptional()
  @IsBoolean()
  forceWindow?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(60)
  maxCatchupDays?: number;
}
