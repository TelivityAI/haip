import { IsString, IsNotEmpty, IsUUID, MaxLength, IsOptional, IsIn } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SendTelegramDto {
  @ApiProperty({ description: 'Property ID (tenant scope)' })
  @IsUUID()
  @IsNotEmpty()
  propertyId!: string;

  @ApiProperty({
    example: '123456789',
    description: 'Telegram chat id (numeric) or @channel username',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  to!: string;

  @ApiProperty({ example: 'Your room is ready — welcome!' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  body!: string;

  @ApiPropertyOptional({ enum: ['HTML', 'MarkdownV2'] })
  @IsOptional()
  @IsIn(['HTML', 'MarkdownV2'])
  parseMode?: 'HTML' | 'MarkdownV2';
}
