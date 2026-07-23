import { IsString, IsOptional, IsUUID, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateArLedgerDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: 'NET60' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  paymentTermsDays?: string;

  @ApiPropertyOptional({ description: 'Optional group/corporate profile link (KB 14.3)' })
  @IsOptional()
  @IsUUID()
  groupProfileId?: string | null;
}
