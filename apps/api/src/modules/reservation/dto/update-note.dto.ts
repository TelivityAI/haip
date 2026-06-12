import { IsString, IsOptional, IsUUID, IsBoolean, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateNoteDto {
  @ApiProperty({ description: 'Property the note belongs to' })
  @IsUUID()
  propertyId!: string;

  @ApiPropertyOptional({ description: 'Updated note body text' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  body?: string;

  @ApiPropertyOptional({ description: 'Active flag (false hides from the badge count)' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
