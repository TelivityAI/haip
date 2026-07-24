import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateConnectCredentialDto {
  @ApiProperty({ example: 'Integration gateway' })
  @IsString()
  @MaxLength(200)
  name!: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'Opaque capability labels stored as credential metadata',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  scopes?: string[];
}
