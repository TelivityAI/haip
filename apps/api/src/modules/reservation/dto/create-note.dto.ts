import { IsString, IsOptional, IsUUID, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateNoteDto {
  @ApiPropertyOptional({
    description:
      'Property the reservation belongs to. Required in the body, or pass ?propertyId= as a query alias when omitted from the body.',
  })
  @IsOptional()
  @IsUUID()
  propertyId?: string;

  @ApiProperty({ description: 'Note body text' })
  @IsString()
  @MinLength(1)
  body!: string;

  @ApiPropertyOptional({ description: 'Staff user who authored the note' })
  @IsOptional()
  @IsUUID()
  authorUserId?: string;
}
