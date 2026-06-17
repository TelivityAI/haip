import { IsString, IsNotEmpty, IsUUID, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SendSmsDto {
  @ApiProperty({ description: 'Property ID (tenant scope)' })
  @IsUUID()
  @IsNotEmpty()
  propertyId!: string;

  @ApiProperty({ example: '+15551234567', description: 'Destination phone number (E.164)' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  to!: string;

  @ApiProperty({ example: 'Your reservation is confirmed. See you on the 24th!' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(1600)
  body!: string;
}
