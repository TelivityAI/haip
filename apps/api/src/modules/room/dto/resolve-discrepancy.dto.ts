import { IsOptional, IsString, IsUUID, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ResolveDiscrepancyDto {
  @ApiProperty({ description: 'Resolution action, e.g. checkout_reservation, correct_hk_observation' })
  @IsString()
  @MinLength(1)
  action!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  resolvedBy?: string;
}

export class DismissDiscrepancyDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  note!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  resolvedBy?: string;
}

export class EnsureDiscrepancyCaseDto {
  @ApiProperty()
  @IsUUID()
  roomId!: string;

  @ApiProperty({ description: 'Business date YYYY-MM-DD' })
  @IsString()
  businessDate!: string;

  @ApiProperty()
  @IsString()
  kind!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  reservationId?: string;
}
