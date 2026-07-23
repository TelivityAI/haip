import { IsString, IsOptional, IsUUID, IsBoolean, MinLength, IsIn, ValidateIf } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ComposeMessageDto {
  @ApiProperty({ description: 'Property the reservation belongs to' })
  @IsUUID()
  propertyId!: string;

  @ApiPropertyOptional({
    description: 'Delivery channel (defaults to email)',
    enum: ['email', 'sms'],
    default: 'email',
  })
  @IsOptional()
  @IsIn(['email', 'sms'])
  channel?: 'email' | 'sms';

  @ApiPropertyOptional({ description: 'Email subject line (required for email channel)' })
  @ValidateIf((o) => o.channel !== 'sms')
  @IsString()
  @MinLength(1)
  subject?: string;

  @ApiProperty({ description: 'Message body (used as both html and text for email)' })
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
