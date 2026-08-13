import { PartialType, OmitType, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';
import { CreateRatePlanDto } from './create-rate-plan.dto';

export class UpdateRatePlanDto extends PartialType(
  OmitType(CreateRatePlanDto, ['propertyId', 'roomTypeId'] as const),
) {
  /**
   * Deactivation. The create DTO never carried isActive (it is a schema
   * default), which left the API with NO way to retire a rate plan — the only
   * lever was validTo, which expires a plan but keeps it active in every
   * isActive-filtered list. Deliberately update-only: plans are created
   * active, and retiring one is an explicit later act.
   */
  @ApiPropertyOptional({ description: 'Set false to deactivate the plan' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
