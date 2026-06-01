import { IsString, IsOptional, IsUUID, IsBoolean, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ComposeMessageDto {
  @ApiProperty({ description: 'Property the reservation belongs to' })
  @IsUUID()
  propertyId!: string;

  @ApiProperty({ description: 'Email subject line' })
  @IsString()
  @MinLength(1)
  subject!: string;

  @ApiProperty({ description: 'Message body (used as both html and text)' })
  @IsString()
  @MinLength(1)
  body!: string;

  @ApiPropertyOptional({
    description:
      'Marketing message — when true, the send is suppressed unless the guest has opted in to marketing (GDPR)',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  isMarketing?: boolean;
}
