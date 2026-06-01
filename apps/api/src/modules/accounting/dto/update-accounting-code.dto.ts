import { IsString, IsOptional, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateAccountingCodeDto {
  @ApiPropertyOptional({ example: 'ROOM-REV' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  code?: string;

  @ApiPropertyOptional({ example: 'Room Revenue' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  label?: string;

  @ApiPropertyOptional({ example: 'room' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  appliesTo?: string;
}
