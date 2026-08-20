import { IsString, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class CancelReservationDto {
  @ApiPropertyOptional({
    description:
      'Cancellation reason (preferred). Connect/bulk use `reason`; both are accepted.',
  })
  @IsOptional()
  @IsString()
  cancellationReason?: string;

  @ApiPropertyOptional({
    description:
      'Alias for cancellationReason (matches Connect/bulk cancel payloads). Ignored when cancellationReason is set.',
  })
  @IsOptional()
  @IsString()
  reason?: string;
}

/** Prefer cancellationReason; accept `reason` as alias (#321 item 2). */
export function resolveCancellationReason(
  dto: Pick<CancelReservationDto, 'cancellationReason' | 'reason'>,
): string | undefined {
  return dto.cancellationReason ?? dto.reason;
}
