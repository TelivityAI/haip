import {
  IsBoolean,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SendWhatsAppDto {
  @ApiProperty({ description: 'Property ID (tenant scope)' })
  @IsUUID()
  propertyId!: string;

  @ApiPropertyOptional({ description: 'Guest ID when the template is tied to a guest profile' })
  @IsOptional()
  @IsUUID()
  guestId?: string;

  @ApiPropertyOptional({ default: false, description: 'Set true for marketing templates; requires guest consent' })
  @IsOptional()
  @IsBoolean()
  marketing?: boolean;

  @ApiProperty({ example: '+15551234567', description: 'Destination WhatsApp number (E.164)' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  to!: string;

  @ApiPropertyOptional({ example: 'HXb5b62575e6e4ff6129ad7c8efe1f983e' })
  @ValidateIf((o) => !o.body)
  @IsString()
  @IsNotEmpty()
  contentSid?: string;

  @ApiPropertyOptional({ example: 'Your room is ready. Reply YES if you would like a digital key.' })
  @ValidateIf((o) => !o.contentSid)
  @IsString()
  @IsNotEmpty()
  body?: string;

  @ApiPropertyOptional({
    description: 'Template variables keyed by placeholder name',
    type: 'object',
    additionalProperties: { type: 'string' },
  })
  @IsOptional()
  @IsObject()
  variables?: Record<string, string>;
}
