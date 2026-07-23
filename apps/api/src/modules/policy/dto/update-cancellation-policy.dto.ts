import { PartialType, OmitType } from '@nestjs/swagger';
import { CreateCancellationPolicyDto } from './create-cancellation-policy.dto';

export class UpdateCancellationPolicyDto extends PartialType(
  OmitType(CreateCancellationPolicyDto, ['propertyId'] as const),
) {}
