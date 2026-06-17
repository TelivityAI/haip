import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/** Guest self-service cancellation of a booking by confirmation number. */
export class BeCancelDto {
  @ApiPropertyOptional({ example: 'Change of plans' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
