import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateRequestCardSetupDto {
  @ApiProperty({ example: 'guest@example.com' })
  @IsEmail()
  @MaxLength(255)
  guestEmail!: string;

  @ApiProperty({
    description: 'Stable client-generated key for this setup attempt.',
    example: 'request-application-018f6f8f',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  idempotencyKey!: string;
}
