import { IsArray, IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdatePreferencesDto {
  @ApiPropertyOptional({ type: [String], example: ['financial-summary', 'occupancy'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  reportFavorites?: string[];
}
