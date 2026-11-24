import { IsDateString, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class StartTaskDto {
  @ApiPropertyOptional({ description: 'Optional ISO start timestamp; defaults to now()' })
  @IsOptional()
  @IsDateString()
  startedAt?: string;
}
